import copy
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pr_owner_gate import evaluate, notification, reconcile

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


if __name__ == "__main__":
    unittest.main()
