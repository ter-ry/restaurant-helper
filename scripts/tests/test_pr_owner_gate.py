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
        snap["comments"] = [gate_comment(7, notification(report, "@owner"))]
        with patch("pr_owner_gate.github_request") as request:
            result = reconcile(snap, report, snap["config"], "token", True)
        self.assertTrue(result["deduplicated"])
        self.assertEqual(request.call_count, 1)

    def test_new_head_withdraws_old_readiness(self):
        old = baseline(); old_report = evaluate(old)
        snap = baseline(); snap["pr"]["head"]["sha"] = "b" * 40
        for check in snap["checks"]: check["head_sha"] = "b" * 40
        snap["reviews"][0]["commit_id"] = "b" * 40; snap["unresolved_review_findings"] = [{"id": 9}]
        snap["comments"] = [gate_comment(7, notification(old_report, "@owner"))]
        with patch("pr_owner_gate.github_request") as request:
            reconcile(snap, evaluate(snap), snap["config"], "token", True)
        self.assertTrue(any(call.args[0] == "PATCH" for call in request.call_args_list))


REPO = "ter-ry/restaurant-helper"
BOT = "github-actions[bot]"


def gate_comment(comment_id, body, login=BOT):
    return {"id": comment_id, "user": {"login": login}, "body": body}


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
        old = baseline(); snap["comments"] = [gate_comment(7, notification(evaluate(old), "@owner"))]
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
        snap["comments"] = [gate_comment(7, withdrawn)]
        calls = []
        with patch("pr_owner_gate.github_request", side_effect=lambda *a, **k: calls.append(a[:2]) or {}):
            result = reconcile(snap, report, snap["config"], "token", True)
        self.assertTrue(result["notified"])
        self.assertFalse(result["deduplicated"])
        self.assertEqual([c[0] for c in calls], ["POST", "POST"])
        self.assertTrue(calls[1][1].endswith("/comments"))

    def test_ready_to_blocked_to_ready_same_sha_renotifies_once(self):
        snap, report = self.ready()
        snap["comments"] = [gate_comment(7, notification(report, "@owner"))]
        blocked = copy.deepcopy(snap); blocked["unresolved_review_findings"] = [{"id": 1}]
        patched = {}
        def request(method, path, token, body=None):
            if method == "PATCH":
                patched["body"] = body["body"]
            return {}
        with patch("pr_owner_gate.github_request", side_effect=request):
            reconcile(blocked, evaluate(blocked), blocked["config"], "token", True)
        self.assertIn("WITHDRAWN", patched["body"])
        snap["comments"] = [gate_comment(7, patched["body"])]
        with patch("pr_owner_gate.github_request") as again:
            self.assertTrue(reconcile(snap, report, snap["config"], "token", True)["notified"])
        self.assertEqual(again.call_count, 2)
        # The freshly posted active comment now deduplicates.
        snap["comments"].append(gate_comment(8, notification(report, "@owner")))
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


def ready_snapshot(sha):
    snap = baseline(); snap["pr"]["head"]["sha"] = sha
    for check in snap["checks"]:
        check["head_sha"] = sha
    snap["reviews"][0]["commit_id"] = sha
    return snap


class NotificationAuthenticationTests(unittest.TestCase):
    def run_reconcile(self, snap):
        calls = []
        def request(method, path, token, body=None):
            calls.append((method, path.rsplit("/", 1)[-1]))
            return {}
        with patch("pr_owner_gate.github_request", side_effect=request):
            result = reconcile(snap, evaluate(snap), snap["config"], "token", True)
        return result, calls

    def test_marker_from_another_user_does_not_deduplicate(self):
        snap = baseline(); report = evaluate(snap)
        snap["comments"] = [gate_comment(7, notification(report, "@owner"), login="attacker")]
        result, calls = self.run_reconcile(snap)
        self.assertTrue(result["notified"])
        self.assertFalse(result["deduplicated"])
        self.assertIn(("POST", "comments"), calls)

    def test_marker_from_owner_account_does_not_deduplicate(self):
        snap = baseline(); report = evaluate(snap)
        snap["comments"] = [gate_comment(7, notification(report, "@owner"), login="ter-ry")]
        self.assertTrue(self.run_reconcile(snap)[0]["notified"])

    def test_forged_ready_comment_is_never_patched(self):
        snap = baseline(); snap["unresolved_review_findings"] = [{"id": 1}]
        snap["comments"] = [gate_comment(7, notification(evaluate(baseline()), "@owner"), login="attacker")]
        _, calls = self.run_reconcile(snap)
        self.assertNotIn("PATCH", [method for method, _ in calls])

    def test_marker_must_start_the_comment(self):
        snap = baseline(); report = evaluate(snap)
        quoted = "I quote the bot:\n" + notification(report, "@owner")
        snap["comments"] = [gate_comment(7, quoted)]
        self.assertTrue(self.run_reconcile(snap)[0]["notified"])

    def test_authentic_comment_deduplicates_and_author_login_is_case_insensitive(self):
        snap = baseline(); report = evaluate(snap)
        snap["comments"] = [gate_comment(7, notification(report, "@owner"), login="GitHub-Actions[bot]")]
        result, calls = self.run_reconcile(snap)
        self.assertTrue(result["deduplicated"])
        self.assertEqual(calls, [("POST", "labels")])

    def test_configured_notification_author_is_used(self):
        snap = baseline(); report = evaluate(snap); snap["config"]["notification_authors"] = "gate-app[bot]"
        snap["comments"] = [gate_comment(7, notification(report, "@owner"), login=BOT)]
        self.assertTrue(self.run_reconcile(snap)[0]["notified"])
        snap["comments"] = [gate_comment(7, notification(report, "@owner"), login="gate-app[bot]")]
        self.assertTrue(self.run_reconcile(snap)[0]["deduplicated"])


class ReadyToReadyTests(unittest.TestCase):
    def test_ready_a_to_ready_b_notifies_b_and_withdraws_a(self):
        a = "a" * 40; b = "b" * 40
        old_report = evaluate(ready_snapshot(a))
        snap = ready_snapshot(b)
        snap["comments"] = [gate_comment(7, notification(old_report, "@owner"))]
        calls = []
        def request(method, path, token, body=None):
            calls.append((method, path.rsplit("/", 1)[-1], body))
            return {}
        with patch("pr_owner_gate.github_request", side_effect=request):
            result = reconcile(snap, evaluate(snap), snap["config"], "token", True)
        self.assertTrue(result["notified"])
        self.assertEqual([c[:2] for c in calls], [("POST", "labels"), ("POST", "comments"), ("PATCH", "7")])
        self.assertIn(f"sha={b}", calls[1][2]["body"])
        self.assertIn("WITHDRAWN", calls[2][2]["body"])
        self.assertIn(f"sha={a}", calls[2][2]["body"])

    def test_ready_state_change_at_same_sha_withdraws_previous_state(self):
        sha = "a" * 40
        old = evaluate(ready_snapshot(sha)); self.assertEqual(old["state"], "VERIFIED FOR OWNER DECISION")
        snap = ready_snapshot(sha); snap["owner_decision_required"] = True
        snap["comments"] = [gate_comment(7, notification(old, "@owner"))]
        with patch("pr_owner_gate.github_request") as request:
            reconcile(snap, evaluate(snap), snap["config"], "token", True)
        self.assertEqual([c.args[0] for c in request.call_args_list], ["POST", "POST", "PATCH"])

    def test_current_notification_is_not_withdrawn_when_still_ready(self):
        snap = baseline(); report = evaluate(snap)
        snap["comments"] = [gate_comment(7, notification(report, "@owner"))]
        with patch("pr_owner_gate.github_request") as request:
            reconcile(snap, report, snap["config"], "token", True)
        self.assertEqual([c.args[0] for c in request.call_args_list], ["POST"])

    def test_already_withdrawn_comments_are_not_patched_again(self):
        a = "a" * 40
        old = notification(evaluate(ready_snapshot(a)), "@owner") + "\n\n**WITHDRAWN:** earlier."
        snap = ready_snapshot("b" * 40); snap["comments"] = [gate_comment(7, old)]
        with patch("pr_owner_gate.github_request") as request:
            reconcile(snap, evaluate(snap), snap["config"], "token", True)
        self.assertNotIn("PATCH", [c.args[0] for c in request.call_args_list])


class CheckClassificationTests(unittest.TestCase):
    def test_pending_ci_is_in_progress_not_failed(self):
        for status in ("queued", "in_progress", "waiting", "pending"):
            snap = baseline(); snap["checks"][0].update(status=status); snap["checks"][0].pop("conclusion", None)
            report = evaluate(snap)
            self.assertEqual(report["state"], "REVIEW IN PROGRESS", status)
            self.assertIn("CI_PENDING:backend", report["outstanding_risks"])
            self.assertFalse(any(r.startswith("CI_FAILED") for r in report["outstanding_risks"]), status)
            self.assertEqual(report["ci"]["backend"], "pending")

    def test_pending_with_explicit_null_conclusion(self):
        snap = baseline(); snap["checks"][0].update(status="in_progress", conclusion=None)
        self.assertEqual(evaluate(snap)["state"], "REVIEW IN PROGRESS")

    def test_completed_failure_still_blocks(self):
        for conclusion in ("failure", "cancelled", "timed_out", "action_required", "skipped", None):
            snap = baseline(); snap["checks"][0]["conclusion"] = conclusion
            report = evaluate(snap)
            self.assertEqual(report["state"], "BLOCKED", conclusion)
            self.assertIn("CI_FAILED:backend", report["outstanding_risks"])

    def test_pending_release_policy_check_is_in_progress(self):
        snap = baseline(); snap["config"]["release_policy_checks"] = "release-policy"
        snap["checks"].append({"name": "release-policy", "head_sha": SHA, "status": "in_progress", "conclusion": None})
        report = evaluate(snap)
        self.assertEqual(report["state"], "REVIEW IN PROGRESS")
        self.assertIn("RELEASE_POLICY_PENDING:release-policy", report["outstanding_risks"])
        snap["checks"][-1].update(status="completed", conclusion="failure")
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")

    def test_configured_check_names_are_case_sensitive(self):
        snap = baseline(); snap["config"]["release_policy_checks"] = "Release Policy"
        snap["checks"].append({"name": "Release Policy", "head_sha": SHA, "status": "completed", "conclusion": "success"})
        self.assertEqual(evaluate(snap)["state"], "VERIFIED FOR OWNER DECISION")
        snap["config"]["release_policy_checks"] = "release policy"  # wrong case never matches
        report = evaluate(snap)
        self.assertEqual(report["state"], "REVIEW IN PROGRESS")
        self.assertIn("RELEASE_POLICY_CHECKS_MISSING:release policy", report["outstanding_risks"])

    def test_required_check_case_is_preserved_in_report(self):
        snap = baseline(); snap["config"]["required_checks"] = "Backend,frontend"
        for check in snap["checks"]:
            if check["name"] == "backend":
                check["name"] = "Backend"
        report = evaluate(snap)
        self.assertEqual(report["state"], "VERIFIED FOR OWNER DECISION")
        self.assertEqual(sorted(report["ci"]), ["Backend", "frontend"])
        snap["config"]["required_checks"] = "backend,frontend"  # GitHub reports "Backend"
        self.assertIn("REQUIRED_CHECKS_MISSING:backend", evaluate(snap)["outstanding_risks"])


class FakeGitHub:
    """Shared PR comment/label store so overlapping runs see each other's writes."""

    def __init__(self, comments=None):
        self.comments = list(comments or [])
        self.labels = set()
        self.calls = []
        self.next_id = 100

    def request(self, method, path, token, body=None):
        self.calls.append((method, path.split("?")[0].rsplit("/", 1)[-1]))
        if method == "GET":
            return [dict(c) for c in self.comments]
        if method == "POST" and path.endswith("/labels"):
            self.labels.update(body["labels"]); return {}
        if method == "POST" and path.endswith("/comments"):
            self.next_id += 1
            self.comments.append(gate_comment(self.next_id, body["body"])); return {}
        if method == "PATCH":
            for c in self.comments:
                if str(c["id"]) == path.rsplit("/", 1)[-1]:
                    c["body"] = body["body"]
            return {}
        if method == "DELETE":
            if "owner-review-needed" not in self.labels:
                raise http_error(404)
            self.labels.discard("owner-review-needed"); return {}
        raise AssertionError((method, path))

    def posts(self):
        return [c for c in self.calls if c == ("POST", "comments")]


def run_with(fake, snap):
    report = evaluate(snap)
    with patch("pr_owner_gate.github_request", side_effect=fake.request):
        return reconcile(snap, report, snap["config"], "token", True,
                         lambda: pr_owner_gate.list_comments(REPO, 42, "token"))


class CheckNameTests(unittest.TestCase):
    def snap(self, required, checks):
        snap = baseline(); snap["config"]["required_checks"] = required
        snap["checks"] = [{"name": n, "head_sha": SHA, "status": "completed", "conclusion": c} for n, c in checks]
        return snap

    def test_slash_names_match_exactly(self):
        report = evaluate(self.snap("backend / unit,frontend", [("backend / unit", "success"), ("frontend", "success")]))
        self.assertEqual(report["state"], "VERIFIED FOR OWNER DECISION")
        self.assertEqual(sorted(report["ci"]), ["backend / unit", "frontend"])

    def test_prefix_does_not_satisfy_or_collapse(self):
        report = evaluate(self.snap("backend,frontend", [("backend / unit", "success"), ("frontend", "success")]))
        self.assertIn("REQUIRED_CHECKS_MISSING:backend", report["outstanding_risks"])
        # A passing "backend / lint" must not mask a failing "backend / unit".
        report = evaluate(self.snap("backend / unit,frontend", [("backend / lint", "success"), ("backend / unit", "failure"), ("frontend", "success")]))
        self.assertEqual(report["state"], "BLOCKED")
        self.assertIn("CI_FAILED:backend / unit", report["outstanding_risks"])

    def test_slash_release_policy_names(self):
        snap = baseline(); snap["config"]["release_policy_checks"] = "Release / policy"
        self.assertIn("RELEASE_POLICY_CHECKS_MISSING:Release / policy", evaluate(snap)["outstanding_risks"])
        snap["checks"].append({"name": "Release / policy", "head_sha": SHA, "status": "completed", "conclusion": "success"})
        self.assertEqual(evaluate(snap)["state"], "VERIFIED FOR OWNER DECISION")
        snap["checks"][-1]["conclusion"] = "failure"
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")

    def test_slash_names_through_collector(self):
        snap = collected_snapshot()
        snap["config"]["required_checks"] = "backend / unit"
        snap["checks"] = [{"name": "backend / unit", "head_sha": SHA, "status": "completed", "conclusion": "success"}]
        self.assertEqual(evaluate(snap)["state"], "VERIFIED FOR OWNER DECISION")


class SerializationTests(unittest.TestCase):
    def test_overlapping_runs_with_empty_snapshots_post_once(self):
        fake = FakeGitHub()
        first, second = baseline(), baseline()          # both collected before any notification existed
        self.assertEqual(first["comments"], []); self.assertEqual(second["comments"], [])
        self.assertTrue(run_with(fake, first)["notified"])
        result = run_with(fake, second)
        self.assertFalse(result["notified"]); self.assertTrue(result["deduplicated"])
        self.assertEqual(len(fake.posts()), 1)
        self.assertEqual(len(fake.comments), 1)

    def test_three_overlapping_runs_across_entry_points_post_once(self):
        fake = FakeGitHub()
        for _ in range(3):
            run_with(fake, baseline())
        self.assertEqual(len(fake.posts()), 1)

    def test_refresh_failure_fails_closed_without_posting(self):
        fake = FakeGitHub(); snap = baseline()
        def broken(method, path, token, body=None):
            if method == "GET":
                raise http_error(502)
            fake.request(method, path, token, body); return {}
        with patch("pr_owner_gate.github_request", side_effect=broken):
            with self.assertRaises(HTTPError):
                reconcile(snap, evaluate(snap), snap["config"], "t", True, lambda: pr_owner_gate.list_comments(REPO, 42, "t"))
        self.assertEqual(fake.calls, [])

    def test_list_comments_paginates_and_caps(self):
        pages = {1: [{"id": i} for i in range(100)], 2: [{"id": 999}]}
        with patch("pr_owner_gate.github_request", side_effect=lambda m, path, t, b=None: pages[int(path.rsplit("&page=", 1)[1])]):
            self.assertEqual(len(pr_owner_gate.list_comments(REPO, 42, "t")), 101)
        with patch("pr_owner_gate.github_request", return_value=[{"id": 1}] * 100):
            with self.assertRaises(ValueError):
                pr_owner_gate.list_comments(REPO, 42, "t")

    def test_main_write_mode_rereads_comments_before_posting(self):
        fake = FakeGitHub(); stale = baseline()
        run_with(fake, baseline())                       # another run already notified
        path = ROOT / "scripts" / "tests" / "_snapshot_tmp2.json"
        path.write_text(json.dumps(stale)); self.addCleanup(lambda: path.unlink(missing_ok=True))
        with patch.dict("os.environ", {"GH_TOKEN": "t"}, clear=True), patch.object(sys, "argv", ["x", "--snapshot", str(path), "--write"]), \
                patch("pr_owner_gate.github_request", side_effect=fake.request), patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(pr_owner_gate.main(), 0)
        self.assertEqual(len(fake.posts()), 1)

    def workflow(self):
        return (ROOT / ".github/workflows/pr-owner-notification-gate.yml").read_text()

    def test_workflow_uses_one_shared_non_cancelling_concurrency_group(self):
        text = self.workflow()
        block = re.search(r"(?m)^concurrency:\n((?:  .*\n)+)", text).group(1)
        self.assertRegex(block, r"(?m)^  group: flowtally-owner-gate$")
        self.assertRegex(block, r"(?m)^  cancel-in-progress: false$")
        self.assertNotIn("${{", block)          # no per-event / per-run group keys
        self.assertNotRegex(text, r"(?m)^    concurrency:")   # no job-level override

    def test_every_run_reconciles_all_candidates_so_superseded_runs_lose_nothing(self):
        text = self.workflow()
        self.assertIn("pulls?state=open&base=main", text)
        self.assertIn("labels=owner-review-needed", text)
        self.assertRegex(text, r'(?s)workflow_dispatch" \].*?PR_NUMBERS="\$EVENT_PR_NUMBER"')

    def test_one_failing_pr_does_not_starve_the_rest(self):
        text = self.workflow()
        self.assertIn("FAILED=1", text); self.assertIn('exit "$FAILED"', text)


class ClosedPullRequestTests(unittest.TestCase):
    def closed(self, merged=False):
        snap = baseline(); snap["pr"]["state"] = "closed"; snap["pr"]["merged"] = merged
        return snap

    def ready_fake(self):
        fake = FakeGitHub(); run_with(fake, baseline())
        self.assertIn("owner-review-needed", fake.labels); self.assertEqual(len(fake.comments), 1)
        fake.calls.clear(); return fake

    def test_ready_then_closed_unmerged_withdraws_and_removes_label(self):
        fake = self.ready_fake()
        snap = self.closed()
        self.assertEqual(evaluate(snap)["state"], "BLOCKED")
        self.assertIn("PR_NOT_OPEN_READY_ON_MAIN", evaluate(snap)["outstanding_risks"])
        result = run_with(fake, snap)
        self.assertFalse(result["notified"])
        self.assertNotIn("owner-review-needed", fake.labels)
        body = fake.comments[0]["body"]
        self.assertIn("WITHDRAWN", body); self.assertIn("closed without merging", body)
        self.assertEqual(len(fake.posts()), 0)

    def test_ready_then_merged_is_withdrawn_with_merged_note(self):
        fake = self.ready_fake()
        run_with(fake, self.closed(merged=True))
        self.assertIn("merged", fake.comments[0]["body"]); self.assertNotIn("owner-review-needed", fake.labels)

    def test_closing_is_idempotent_and_tolerates_absent_label(self):
        fake = self.ready_fake()
        run_with(fake, self.closed()); fake.calls.clear()
        run_with(fake, self.closed())                       # repeat: label gone -> 404 tolerated, nothing to patch
        self.assertNotIn("PATCH", [m for m, _ in fake.calls])
        fresh = FakeGitHub()
        run_with(fresh, self.closed())                      # never notified, never labelled
        self.assertEqual(fresh.comments, [])

    def test_closed_then_reopened_ready_notifies_again(self):
        fake = self.ready_fake()
        run_with(fake, self.closed())
        result = run_with(fake, baseline())
        self.assertTrue(result["notified"])
        self.assertEqual(len([c for c in fake.comments if "WITHDRAWN" not in c["body"]]), 1)
        self.assertIn("owner-review-needed", fake.labels)

    def test_closed_pr_is_not_trusted_even_with_forged_ready_comment(self):
        fake = FakeGitHub([gate_comment(5, notification(evaluate(baseline()), "@owner"), login="attacker")])
        run_with(fake, self.closed())
        self.assertNotIn("WITHDRAWN", fake.comments[0]["body"])

    def test_workflow_triggers_on_closed(self):
        text = (ROOT / ".github/workflows/pr-owner-notification-gate.yml").read_text()
        self.assertRegex(text, r"pull_request_target:\n    types: \[[^\]]*\bclosed\b")


class ReviewThresholdTests(unittest.TestCase):
    def one_approval(self, path, **config):
        snap = baseline(); snap["changed_files"] = [path]; snap["config"].update(config)
        return evaluate(snap)

    def test_unset_high_risk_override_inherits_general_threshold(self):
        low = self.one_approval("docs/runbook.md", independent_reviews=2)
        high = self.one_approval("backend/auth.py", independent_reviews=2)
        self.assertEqual((low["review_evidence"]["required"], high["review_evidence"]["required"]), (2, 2))
        self.assertEqual(high["state"], "REVIEW IN PROGRESS")
        self.assertIn("INDEPENDENT_REVIEW_MISSING:1/2", high["outstanding_risks"])

    def test_weaker_override_cannot_lower_the_general_threshold(self):
        report = self.one_approval("backend/auth.py", independent_reviews=3, independent_reviews_high_risk=1)
        self.assertEqual(report["review_evidence"]["required"], 3)
        self.assertEqual(report["state"], "REVIEW IN PROGRESS")

    def test_stronger_override_applies_only_to_high_risk(self):
        self.assertEqual(self.one_approval("backend/auth.py", independent_reviews=1, independent_reviews_high_risk=2)["review_evidence"]["required"], 2)
        self.assertEqual(self.one_approval("docs/runbook.md", independent_reviews=1, independent_reviews_high_risk=2)["review_evidence"]["required"], 1)

    def test_defaults_and_string_config_values(self):
        self.assertEqual(self.one_approval("backend/auth.py")["review_evidence"]["required"], 1)
        self.assertEqual(self.one_approval("backend/auth.py", independent_reviews="2", independent_reviews_high_risk="")["review_evidence"]["required"], 2)
        self.assertEqual(self.one_approval("backend/auth.py", independent_reviews=0, independent_reviews_high_risk=0)["review_evidence"]["required"], 1)

    def test_invalid_threshold_fails_loudly(self):
        with self.assertRaises(ValueError):
            self.one_approval("backend/auth.py", independent_reviews="two")

    def test_enough_approvals_still_reaches_owner_review_needed(self):
        snap = baseline(); snap["changed_files"] = ["backend/auth.py"]; snap["config"]["independent_reviews"] = 2
        snap["reviews"].append({"user": {"login": "reviewer2"}, "state": "APPROVED", "commit_id": SHA, "submitted_at": "2026-11-08T01:00:00Z"})
        snap["config"]["trusted_reviewers"] = "reviewer,reviewer2"
        self.assertEqual(evaluate(snap)["state"], "OWNER REVIEW NEEDED")


if __name__ == "__main__":
    unittest.main()
