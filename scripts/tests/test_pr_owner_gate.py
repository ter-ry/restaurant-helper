import copy
import io
import json
import re
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pr_owner_gate
import pr_owner_gate_collect as collect
from pr_owner_gate import evaluate, notification, reconcile

ROOT = Path(__file__).resolve().parents[2]

SHA = "a" * 40


def baseline():
    return {"repository": "ter-ry/restaurant-helper", "pr": {"number": 42, "state": "open", "draft": False,
        "user": {"login": "author"}, "base": {"ref": "main"}, "head": {"sha": SHA, "repo": {"full_name": "ter-ry/restaurant-helper"}},
        "mergeable": True, "mergeable_state": "clean", "html_url": "https://github.com/ter-ry/restaurant-helper/pull/42"},
        "checks": [{"name": name, "head_sha": SHA, "status": "completed", "conclusion": "success"} for name in ("backend", "frontend")],
        "reviews": [{"user": {"login": "reviewer"}, "state": "APPROVED", "commit_id": SHA, "submitted_at": "2026-11-08T00:00:00Z"}],
        "comments": [], "changed_files": ["docs/runbook.md"], "unresolved_review_findings": [],
        "config": {"trusted_reviewers": "reviewer", "required_checks": "backend,frontend", "owner_mention": "@owner"}}


class OwnerGateTests(unittest.TestCase):
    def test_verified_exact_head(self):
        self.assertEqual(evaluate(baseline())["state"], "VERIFIED FOR OWNER DECISION")

    def test_stale_review_is_not_approval(self):
        snap = baseline(); snap["reviews"][0]["commit_id"] = "b" * 40
        self.assertEqual(evaluate(snap)["state"], "REVIEW IN PROGRESS")

    def test_failed_ci_blocks(self):
        snap = baseline(); snap["checks"][0]["conclusion"] = "failure"
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")

    def test_open_findings_block(self):
        snap = baseline(); snap["unresolved_review_findings"] = [{"id": 1}]
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")

    def test_same_account_agents_do_not_count_twice(self):
        snap = baseline(); snap["reviews"].append({"user": {"login": "author"}, "state": "APPROVED", "commit_id": SHA})
        snap["config"]["trusted_reviewers"] = "reviewer,author"; snap["config"]["independent_reviews"] = 2
        self.assertIn("INDEPENDENT_REVIEW_MISSING", " ".join(evaluate(snap)["outstanding_risks"]))

    def test_review_conflict_blocks(self):
        snap = baseline(); snap["review_conflict"] = True
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")

    def test_high_risk_requires_stronger_review(self):
        snap = baseline(); snap["changed_files"] = ["backend/migrations/versions/0040_inventory.py"]
        snap["config"]["independent_reviews_high_risk"] = 2
        report = evaluate(snap)
        self.assertEqual(report["state"], "REVIEW IN PROGRESS")
        self.assertIn("HIGH_RISK_OWNER_GATE", report["outstanding_risks"])

    def test_duplicate_key_and_new_head_change_notification(self):
        first = evaluate(baseline())
        snap = baseline(); snap["pr"]["head"]["sha"] = "b" * 40
        second = evaluate(snap)
        self.assertNotEqual(first["head_sha"], second["head_sha"])
        self.assertIn("SHA", notification(first, "@owner"))

    def test_missing_policy_check_is_in_progress(self):
        snap = baseline(); snap["config"]["release_policy_checks"] = "release-policy"
        self.assertEqual(evaluate(snap)["state"], "REVIEW IN PROGRESS")

    def test_duplicate_notification_is_suppressed(self):
        snap = baseline(); report = evaluate(snap)
        snap["comments"] = [{"id": 7, "body": notification(report, "@owner")}]
        with patch("pr_owner_gate.github_request") as request:
            result = reconcile(snap, report, snap["config"], "token", True)
        self.assertTrue(result["deduplicated"])
        self.assertEqual(request.call_count, 1)

    def test_new_head_withdraws_old_readiness(self):
        old = baseline(); old_report = evaluate(old)
        snap = baseline(); snap["pr"]["head"]["sha"] = "b" * 40
        for check in snap["checks"]: check["head_sha"] = "b" * 40
        snap["reviews"][0]["commit_id"] = "b" * 40; snap["unresolved_review_findings"] = [{"id": 9}]
        snap["comments"] = [{"id": 7, "body": notification(old_report, "@owner")}]
        with patch("pr_owner_gate.github_request") as request:
            reconcile(snap, evaluate(snap), snap["config"], "token", True)
        self.assertTrue(any(call.args[0] == "PATCH" for call in request.call_args_list))


REPO = "ter-ry/restaurant-helper"


def thread(resolved=False, outdated=False):
    return {"isResolved": resolved, "isOutdated": outdated, "comments": {"nodes": [{"databaseId": 1}]}}


def graphql_page(nodes, has_next=False, cursor=None):
    return {"data": {"repository": {"pullRequest": {"reviewThreads": {"pageInfo": {"hasNextPage": has_next, "endCursor": cursor}, "nodes": nodes}}}}}


def http_error(code):
    return HTTPError("https://api.github.com/x", code, "err", {}, io.BytesIO(b"{}"))


def collected_snapshot(pr_extra=None, threads=None, graphql=None):
    """Run the real collector against canned REST/GraphQL responses."""
    base = baseline()
    pr = dict(base["pr"], **(pr_extra or {}))

    def rest(path, token):
        if path.endswith(f"/pulls/42"):
            return pr
        if "/check-runs" in path:
            return {"check_runs": base["checks"]}
        if path.startswith(f"repos/{REPO}/pulls/42/reviews"):
            return base["reviews"]
        if path.startswith(f"repos/{REPO}/pulls/42/files"):
            return [{"filename": name} for name in base["changed_files"]]
        return []

    gql = graphql or (lambda query, variables, token: graphql_page(threads or []))
    snapshot = collect.build_snapshot(REPO, 42, "token", base["config"], rest, gql)
    return snapshot


class CollectorToEvaluatorTests(unittest.TestCase):
    def test_collected_clean_pr_is_verified(self):
        self.assertEqual(evaluate(collected_snapshot())["state"], "VERIFIED FOR OWNER DECISION")

    def test_graphql_errors_without_data_fail_closed(self):
        snap = collected_snapshot(graphql=lambda *a: {"errors": [{"message": "unavailable"}]})
        self.assertIsNone(snap["unresolved_review_findings"])
        report = evaluate(snap)
        self.assertEqual(report["state"], "BLOCKED")
        self.assertIn("UNRESOLVED_FINDINGS_UNVERIFIED", report["outstanding_risks"])

    def test_graphql_malformed_partial_or_raising_fail_closed(self):
        for response in ({}, {"data": None}, {"data": {"repository": None}}, {"data": {"repository": {"pullRequest": {}}}},
                         {"data": {"repository": {"pullRequest": {"reviewThreads": {"nodes": None}}}}}, graphql_page([{"isOutdated": False}]), "x"):
            snap = collected_snapshot(graphql=lambda *a, r=response: r)
            self.assertIsNone(snap["unresolved_review_findings"], response)
        def boom(*args):
            raise OSError("network down")
        self.assertEqual(evaluate(collected_snapshot(graphql=boom))["state"], "BLOCKED")

    def test_graphql_errors_alongside_data_fail_closed(self):
        response = dict(graphql_page([]), errors=[{"message": "partial"}])
        self.assertIsNone(collected_snapshot(graphql=lambda *a: response)["unresolved_review_findings"])

    def test_outdated_unresolved_thread_still_blocks(self):
        snap = collected_snapshot(threads=[thread(resolved=False, outdated=True)])
        self.assertEqual(len(snap["unresolved_review_findings"]), 1)
        report = evaluate(snap)
        self.assertEqual(report["state"], "BLOCKED")
        self.assertIn("OPEN_REVIEW_FINDINGS:1", report["outstanding_risks"])

    def test_resolved_threads_do_not_block_even_if_outdated(self):
        snap = collected_snapshot(threads=[thread(resolved=True, outdated=True), thread(resolved=True)])
        self.assertEqual(snap["unresolved_review_findings"], [])
        self.assertEqual(evaluate(snap)["state"], "VERIFIED FOR OWNER DECISION")

    def test_thread_pagination_is_followed_and_incomplete_pagination_fails_closed(self):
        calls = []
        def paged(query, variables, token):
            calls.append(variables["cursor"])
            if variables["cursor"] is None:
                return graphql_page([thread(resolved=True)], True, "c1")
            return graphql_page([thread(resolved=False)])
        self.assertEqual(len(collected_snapshot(graphql=paged)["unresolved_review_findings"]), 1)
        self.assertEqual(calls, [None, "c1"])
        self.assertIsNone(collected_snapshot(graphql=lambda *a: graphql_page([], True, None))["unresolved_review_findings"])
        self.assertIsNone(collected_snapshot(graphql=lambda *a: graphql_page([], True, "again"))["unresolved_review_findings"])

    def test_requested_reviewer_blocks_through_collector(self):
        snap = collected_snapshot(pr_extra={"requested_reviewers": [{"login": "someone"}]})
        self.assertEqual(snap["pending_reviewers"], ["someone"])
        report = evaluate(snap)
        self.assertEqual(report["state"], "BLOCKED")
        self.assertIn("REVIEW_PENDING:someone", report["outstanding_risks"])

    def test_requested_team_blocks_through_collector(self):
        snap = collected_snapshot(pr_extra={"requested_teams": [{"slug": "backend"}]})
        self.assertEqual(snap["pending_reviewers"], ["team:backend"])
        self.assertIn("REVIEW_PENDING:team:backend", evaluate(snap)["outstanding_risks"])

    def test_evaluator_reads_requested_reviewers_from_raw_pr(self):
        snap = baseline(); snap["pr"]["requested_reviewers"] = [{"login": "someone"}]
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")


class RiskClassificationTests(unittest.TestCase):
    def test_security_and_financial_modules_are_high_risk(self):
        for path in ("backend/auth.py", "backend/tenant_context.py", "backend/daily_close.py", "backend/costing.py",
                     ".github/workflows/deploy.yml", "render.yaml", "AGENTS.md"):
            snap = baseline(); snap["changed_files"] = [path]; snap["config"]["independent_reviews_high_risk"] = 2
            report = evaluate(snap)
            self.assertTrue(report["high_risk"], path)
            self.assertIn("HIGH_RISK_OWNER_GATE", report["outstanding_risks"], path)
            self.assertIn("INDEPENDENT_REVIEW_MISSING:1/2", report["outstanding_risks"], path)
            self.assertEqual(report["state"], "REVIEW IN PROGRESS", path)

    def test_docs_only_change_is_low_risk(self):
        snap = baseline(); snap["changed_files"] = ["docs/runbook.md", "src/pages/Home.tsx"]
        self.assertFalse(evaluate(snap)["high_risk"])

    def test_keyword_backstop_still_applies(self):
        snap = baseline(); snap["changed_files"] = ["src/lib/inventoryMath.ts"]
        self.assertTrue(evaluate(snap)["high_risk"])


class WriteModeTests(unittest.TestCase):
    def ready(self):
        snap = baseline()
        return snap, evaluate(snap)

    def test_absent_label_delete_404_is_success_and_withdrawal_continues(self):
        snap = baseline(); snap["unresolved_review_findings"] = [{"id": 1}]
        old = baseline(); snap["comments"] = [{"id": 7, "body": notification(evaluate(old), "@owner")}]
        calls = []
        def request(method, path, token, body=None):
            calls.append(method)
            if method == "DELETE":
                raise http_error(404)
            return {}
        with patch("pr_owner_gate.github_request", side_effect=request):
            result = reconcile(snap, evaluate(snap), snap["config"], "token", True)
        self.assertEqual(calls, ["DELETE", "PATCH"])
        self.assertEqual(result["state"], "BLOCKED")

    def test_other_label_delete_errors_propagate(self):
        snap = baseline(); snap["unresolved_review_findings"] = [{"id": 1}]
        for code in (403, 500):
            with patch("pr_owner_gate.github_request", side_effect=http_error(code)):
                with self.assertRaises(HTTPError):
                    reconcile(snap, evaluate(snap), snap["config"], "token", True)

    def test_withdrawn_notification_does_not_deduplicate(self):
        snap, report = self.ready()
        withdrawn = notification(report, "@owner") + "\n\n**WITHDRAWN:** the PR head or readiness state changed; reassess the current SHA."
        snap["comments"] = [{"id": 7, "body": withdrawn}]
        calls = []
        with patch("pr_owner_gate.github_request", side_effect=lambda *a, **k: calls.append(a[:2]) or {}):
            result = reconcile(snap, report, snap["config"], "token", True)
        self.assertTrue(result["notified"])
        self.assertFalse(result["deduplicated"])
        self.assertEqual([c[0] for c in calls], ["POST", "POST"])
        self.assertTrue(calls[1][1].endswith("/comments"))

    def test_ready_to_blocked_to_ready_same_sha_renotifies_once(self):
        snap, report = self.ready()
        snap["comments"] = [{"id": 7, "body": notification(report, "@owner")}]
        blocked = copy.deepcopy(snap); blocked["unresolved_review_findings"] = [{"id": 1}]
        patched = {}
        def request(method, path, token, body=None):
            if method == "PATCH":
                patched["body"] = body["body"]
            return {}
        with patch("pr_owner_gate.github_request", side_effect=request):
            reconcile(blocked, evaluate(blocked), blocked["config"], "token", True)
        self.assertIn("WITHDRAWN", patched["body"])
        snap["comments"] = [{"id": 7, "body": patched["body"]}]
        with patch("pr_owner_gate.github_request") as again:
            self.assertTrue(reconcile(snap, report, snap["config"], "token", True)["notified"])
        self.assertEqual(again.call_count, 2)
        # The freshly posted active comment now deduplicates.
        snap["comments"].append({"id": 8, "body": notification(report, "@owner")})
        with patch("pr_owner_gate.github_request") as third:
            self.assertTrue(reconcile(snap, report, snap["config"], "token", True)["deduplicated"])
        self.assertEqual(third.call_count, 1)


class TokenPropagationTests(unittest.TestCase):
    def run_main(self, env, write=True):
        snap = baseline()
        path = ROOT / "scripts" / "tests" / "_snapshot_tmp.json"
        path.write_text(json.dumps(snap))
        self.addCleanup(lambda: path.unlink(missing_ok=True))
        argv = ["pr_owner_gate.py", "--snapshot", str(path)] + (["--write"] if write else [])
        tokens = []
        with patch.dict("os.environ", env, clear=True), patch.object(sys, "argv", argv), \
                patch("pr_owner_gate.github_request", side_effect=lambda m, p, t, b=None: tokens.append(t) or {}), \
                patch("sys.stdout", new_callable=io.StringIO), patch("sys.stderr", new_callable=io.StringIO):
            code = pr_owner_gate.main()
        return code, tokens

    def test_gh_token_only_reaches_github_requests(self):
        code, tokens = self.run_main({"GH_TOKEN": "workflow-token"})
        self.assertEqual(code, 0)
        self.assertTrue(tokens and set(tokens) == {"workflow-token"})

    def test_github_token_is_accepted_too(self):
        self.assertEqual(self.run_main({"GITHUB_TOKEN": "t2"})[1][0], "t2")

    def test_write_mode_without_token_fails_before_any_request(self):
        code, tokens = self.run_main({})
        self.assertEqual(code, 1)
        self.assertEqual(tokens, [])

    def test_dry_run_needs_no_token_and_writes_nothing(self):
        code, tokens = self.run_main({}, write=False)
        self.assertEqual((code, tokens), (0, []))

    def test_workflow_exports_both_token_names_to_collect_step(self):
        text = (ROOT / ".github/workflows/pr-owner-notification-gate.yml").read_text()
        self.assertRegex(text, r"(?m)^\s+GH_TOKEN: \$\{\{ github\.token \}\}$")
        self.assertRegex(text, r"(?m)^\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}$")

    def test_workflow_keeps_write_mode_and_gate_disabled_by_default(self):
        text = (ROOT / ".github/workflows/pr-owner-notification-gate.yml").read_text()
        self.assertIn("vars.FLOWTALLY_OWNER_GATE_WRITE || 'false'", text)
        self.assertIn("vars.FLOWTALLY_OWNER_GATE_ENABLED == 'true'", text)
        self.assertNotRegex(text, r"(?i)merge_method|gh pr merge|/merge")


if __name__ == "__main__":
    unittest.main()
