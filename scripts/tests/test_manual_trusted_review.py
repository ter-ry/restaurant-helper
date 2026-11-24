import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import manual_trusted_review as m
import trusted_review_attestation as att
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


NOW = datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc)
KEY = Ed25519PrivateKey.generate()


def evidence(**changes):
    payload = {"repo_id": m.REPOSITORY_ID, "pr": m.PR_NUMBER, "head_sha": m.HEAD_SHA, "base_sha": m.BASE_SHA,
               "changed_files_sha256": "0" * 64, "reviewer_session_id": "manual-r1", "author_session_ids": ["author"],
               "nonce": "one-time", "issued_at": "2026-11-24T11:30:00Z", "expires_at": "2026-11-24T12:30:00Z",
               "evaluator_main_sha": m.MAIN_SHA}
    review = {"state": "APPROVED", "commit_id": m.HEAD_SHA,
              "body": m.R1_MARKER + "\n" + att.sign_attestation(KEY, payload),
              "user": {"id": 42, "login": "independent-r1", "type": "User"}}
    out = {"repository": m.REPOSITORY,
           "pr": {"number": m.PR_NUMBER, "state": "open", "draft": False, "base_ref": "develop", "base_sha": m.BASE_SHA,
                  "head_sha": m.HEAD_SHA, "base_repo": m.REPOSITORY, "head_repo": m.REPOSITORY, "author": "ter-ry"},
           "head_parents": list(m.PARENT_SHAS), "main_sha": m.MAIN_SHA, "head_tree": m.TREE_SHA, "main_tree": m.TREE_SHA,
           "threads": [{"id": i, "is_resolved": True} for i in m.THREAD_IDS],
           "checks": [{"name": n, "head_sha": m.HEAD_SHA, "base_sha": m.BASE_SHA, "status": "completed", "conclusion": "success",
                       "app_slug": "github-actions"} for n in ("backend", "frontend")],
           "reviews": [review], "requested_reviewers": [], "security_controls_unchanged": True}
    out.update(changes)
    return out


class ManualVerifierTests(unittest.TestCase):
    def run_ok(self, ev=None):
        return m.verify_manual(ev or evidence(), public_key=KEY.public_key().public_bytes_raw(), now=NOW)

    def test_positive_exact_pinned_evidence(self):
        self.assertTrue(self.run_ok()["verified"])

    def test_stale_head_and_changed_base(self):
        result = self.run_ok(evidence(pr={**evidence()["pr"], "head_sha": "a" * 40, "base_sha": "b" * 40}))
        self.assertIn("stale_head_or_base", result["reasons"])

    def test_missing_independent_approval_and_owner_receipt_do_not_count(self):
        ev = evidence(reviews=[{"state": "COMMENTED", "commit_id": m.HEAD_SHA, "body": "Codex no findings", "user": {"id": 1, "login": "ter-ry", "type": "User"}}])
        result = self.run_ok(ev)
        self.assertIn("missing_independent_approval", result["reasons"])

    def test_later_reviewer_state_retracts_approval(self):
        review = evidence()["reviews"][0]
        retracted = {**review, "id": 99, "submitted_at": "2026-11-24T12:01:00Z", "state": "CHANGES_REQUESTED"}
        self.assertIn("missing_independent_approval", self.run_ok(evidence(reviews=[review, retracted]))["reasons"])

    def test_invalid_signature_and_expired_attestation(self):
        bad = evidence(reviews=[{**evidence()["reviews"][0], "body": m.R1_MARKER + "\n" + att.sign_attestation(Ed25519PrivateKey.generate(), {"repo_id": m.REPOSITORY_ID, "pr": m.PR_NUMBER, "head_sha": m.HEAD_SHA, "base_sha": m.BASE_SHA, "changed_files_sha256": "0" * 64, "reviewer_session_id": "x", "author_session_ids": ["author"], "nonce": "n", "issued_at": "2026-11-24T11:00:00Z", "expires_at": "2026-11-24T12:30:00Z", "evaluator_main_sha": m.MAIN_SHA})}])
        self.assertIn("invalid_signature", self.run_ok(bad)["reasons"])
        expired = evidence(reviews=[{**evidence()["reviews"][0], "body": m.R1_MARKER + "\n" + att.sign_attestation(KEY, {"repo_id": m.REPOSITORY_ID, "pr": m.PR_NUMBER, "head_sha": m.HEAD_SHA, "base_sha": m.BASE_SHA, "changed_files_sha256": "0" * 64, "reviewer_session_id": "x", "author_session_ids": ["author"], "nonce": "n", "issued_at": "2026-11-24T09:00:00Z", "expires_at": "2026-11-24T10:00:00Z", "evaluator_main_sha": m.MAIN_SHA})}])
        self.assertIn("expired_attestation", self.run_ok(expired)["reasons"])

    def test_changed_tree_unresolved_thread_wrong_app_and_ci(self):
        self.assertIn("source_tree_mismatch", self.run_ok(evidence(head_tree="f" * 40))["reasons"])
        self.assertIn("unresolved_thread", self.run_ok(evidence(threads=[{"id": i, "is_resolved": i != next(iter(m.THREAD_IDS))} for i in m.THREAD_IDS]))["reasons"])
        self.assertIn("exact_head_ci:backend", self.run_ok(evidence(checks=[{"name": "backend", "head_sha": m.HEAD_SHA, "base_sha": m.BASE_SHA, "status": "completed", "conclusion": "success", "app_slug": "forged-app"}, evidence()["checks"][1]]))["reasons"])

    def test_target_is_owner_triggered_and_one_time(self):
        self.assertEqual(m.check_target("other", m.PR_NUMBER, m.HEAD_SHA, m.BASE_SHA), ["owner_trigger_required"])
        self.assertEqual(m.check_target("ter-ry", 388, m.HEAD_SHA, m.BASE_SHA), ["target_is_pinned_to_387"])

    def test_incorrect_verifier_app_identity_never_qualifies(self):
        check = {"name": att.CHECK_NAME, "head_sha": m.HEAD_SHA, "status": "completed", "conclusion": "success", "app": {"id": 9}}
        self.assertEqual(m.verify_published_check(check, 10), ["check_not_from_verifier"])


if __name__ == "__main__":
    unittest.main()
