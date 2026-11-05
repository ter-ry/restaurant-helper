"""Fail-closed tests for the read-only agent handoff preflight."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from agent_handoff_audit import evaluate

SHA = "a" * 40


def baseline():
    return {
        "repository": "ter-ry/restaurant-helper",
        "pr": {
            "number": 200,
            "state": "open",
            "draft": False,
            "user": {"login": "ter-ry"},
            "base": {"ref": "main"},
            "head": {"sha": SHA, "repo": {"full_name": "ter-ry/restaurant-helper"}},
        },
        "checks": [
            {"name": name, "head_sha": SHA, "status": "completed", "conclusion": "success"}
            for name in ("backend", "frontend")
        ],
        "changed_files": ["docs/README.md"],
        "comments": [
            {"user": {"login": "independent-reviewer"}, "body": f"APPROVE @ {SHA}",
             "created_at": "2026-11-04T22:00:00Z"}
        ],
        "reviews": [],
        "open_review_threads": False,
        "canonical_claim_verified": True,
        "dependencies_merged": True,
    }


class AgentHandoffTests(unittest.TestCase):
    def audit(self, changed=None, reviewers=("independent-reviewer",)):
        return evaluate(changed if changed is not None else baseline(), set(reviewers))

    def test_advisory_approval_never_executes_merge(self):
        report = self.audit()
        self.assertEqual(report["handoff"], "OWNER_REVIEW_REQUIRED")
        self.assertFalse(report["eligible_for_automatic_merge"])
        self.assertEqual(report["actions_executed"], [])
        self.assertEqual(report["reasons"], [])

    def test_same_account_codex_comment_is_not_independent(self):
        snap = baseline()
        snap["comments"][0]["user"]["login"] = "ter-ry"
        report = self.audit(snap, reviewers=("ter-ry",))
        self.assertIn("INDEPENDENT_REVIEW_MISSING", report["reasons"])

    def test_stale_approval_is_not_valid(self):
        snap = baseline()
        snap["comments"][0]["body"] = "APPROVE @ " + "b" * 40
        self.assertIn("INDEPENDENT_REVIEW_MISSING", self.audit(snap)["reasons"])

    def test_untrusted_author_cannot_fake_reviewer(self):
        snap = baseline()
        snap["comments"][0]["user"]["login"] = "untrusted"
        self.assertIn("INDEPENDENT_REVIEW_MISSING", self.audit(snap)["reasons"])

    def test_latest_trusted_request_changes_routes_repair(self):
        snap = baseline()
        snap["comments"].append(
            {"user": {"login": "independent-reviewer"}, "body": f"REQUEST CHANGES @ {SHA}",
             "created_at": "2026-11-04T22:01:00Z"}
        )
        report = self.audit(snap)
        self.assertEqual(report["handoff"], "AUTHOR_REPAIR_REQUIRED")
        self.assertIn("TRUSTED_CHANGES_REQUESTED", report["reasons"])

    def test_old_request_cleared_by_new_trusted_approval(self):
        snap = baseline()
        snap["comments"].insert(0, {
            "user": {"login": "independent-reviewer"}, "body": f"REQUEST CHANGES @ {SHA}",
            "created_at": "2026-11-04T21:00:00Z"
        })
        self.assertNotIn("TRUSTED_CHANGES_REQUESTED", self.audit(snap)["reasons"])

    def test_failed_ci_routes_repair(self):
        snap = baseline()
        snap["checks"][0]["conclusion"] = "failure"
        self.assertEqual(self.audit(snap)["handoff"], "AUTHOR_REPAIR_REQUIRED")

    def test_missing_ci_waits(self):
        snap = baseline()
        snap["checks"] = snap["checks"][:1]
        self.assertEqual(self.audit(snap)["handoff"], "AWAIT_CI")

    def test_stale_ci_cannot_pass(self):
        snap = baseline()
        snap["checks"][0]["head_sha"] = "b" * 40
        self.assertTrue(any(x.startswith("REQUIRED_CHECKS_MISSING") for x in self.audit(snap)["reasons"]))

    def test_high_risk_requires_owner(self):
        snap = baseline()
        snap["changed_files"] = ["backend/clover_sales.py", ".github/workflows/ci.yml"]
        self.assertIn("HIGH_RISK_OWNER_GATE", self.audit(snap)["reasons"])

    def test_unknown_claim_dependencies_and_threads_fail_closed(self):
        snap = baseline()
        snap["canonical_claim_verified"] = None
        snap["dependencies_merged"] = None
        snap["open_review_threads"] = None
        reasons = self.audit(snap)["reasons"]
        for reason in ("CANONICAL_CLAIM_UNVERIFIED", "DEPENDENCIES_UNVERIFIED", "REVIEW_THREADS_UNVERIFIED"):
            self.assertIn(reason, reasons)

    def test_closed_pr_never_is_ready(self):
        snap = baseline()
        snap["pr"]["state"] = "closed"
        self.assertIn("PR_NOT_OPEN_READY_ON_MAIN", self.audit(snap)["reasons"])

    def test_formal_review_must_match_sha_and_identity(self):
        snap = baseline()
        snap["comments"] = []
        snap["reviews"] = [{
            "user": {"login": "independent-reviewer"}, "state": "APPROVED",
            "commit_id": SHA, "submitted_at": "2026-11-04T22:00:00Z"
        }]
        self.assertNotIn("INDEPENDENT_REVIEW_MISSING", self.audit(snap)["reasons"])
        snap["reviews"][0]["commit_id"] = "b" * 40
        self.assertIn("INDEPENDENT_REVIEW_MISSING", self.audit(snap)["reasons"])


if __name__ == "__main__":
    unittest.main()
