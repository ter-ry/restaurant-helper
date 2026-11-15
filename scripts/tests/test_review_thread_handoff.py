"""Fail-closed tests for the read-only review-thread handoff classifier (#305)."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import review_thread_handoff as h

HEAD = "a" * 40
OLD = "b" * 40


def snap(**over):
    s = {
        "pr": {"number": 304, "state": "open", "user": {"login": "ter-ry"}, "head_sha": HEAD},
        "threads_verified": True,
        "threads": [{"id": "T1", "isResolved": True, "comments": []}],
        "checks": [{"name": n, "head_sha": HEAD, "status": "completed", "conclusion": "success"}
                   for n in ("backend", "frontend")],
        "comments": [{"user": {"login": "reviewer"}, "body": f"APPROVE @ {HEAD}"}],
    }
    s.update(over)
    return s


def unresolved(body=None):
    return [{"id": "T1", "isResolved": False, "comments": [{"body": body}] if body else []}]


class ClassifyTests(unittest.TestCase):
    def test_all_resolved_green_approved_is_owner_merge_pending(self):
        r = h.classify(snap())
        self.assertEqual(r["state"], h.OWNER_MERGE_PENDING)
        self.assertTrue(r["mark_owner_merge_ready"])

    def test_green_and_approved_but_thread_unresolved_is_not_merge_ready(self):
        r = h.classify(snap(threads=unresolved(f"Fixed @ {HEAD} test x")))
        self.assertEqual(r["state"], h.FIX_PENDING_VERIFICATION)
        self.assertFalse(r["mark_owner_merge_ready"])

    def test_unresolved_without_fix_at_head_is_finding_open(self):
        self.assertEqual(h.classify(snap(threads=unresolved()))["state"], h.FINDING_OPEN)

    def test_fix_reply_at_old_sha_or_reverted_fix_stays_open(self):
        self.assertEqual(h.classify(snap(threads=unresolved(f"Fixed @ {OLD}")))["state"], h.FINDING_OPEN)

    def test_approval_at_wrong_sha_is_stale(self):
        s = snap(comments=[{"user": {"login": "reviewer"}, "body": f"APPROVE @ {OLD}"}])
        self.assertEqual(h.classify(s)["state"], h.APPROVAL_STALE)

    def test_author_cannot_approve_own_pr(self):
        s = snap(comments=[{"user": {"login": "Ter-Ry"}, "body": f"APPROVE @ {HEAD}"}])
        self.assertNotEqual(h.classify(s)["state"], h.OWNER_MERGE_PENDING)

    def test_request_changes_at_head_blocks(self):
        s = snap(comments=[{"user": {"login": "r"}, "body": f"APPROVE @ {HEAD}"},
                           {"user": {"login": "r"}, "body": f"REQUEST CHANGES @ {HEAD}"}])
        self.assertNotEqual(h.classify(s)["state"], h.OWNER_MERGE_PENDING)

    def test_ci_for_other_sha_or_failing_is_not_green(self):
        s = snap(checks=[{"name": n, "head_sha": OLD, "status": "completed", "conclusion": "success"}
                         for n in ("backend", "frontend")])
        self.assertEqual(h.classify(s)["state"], h.CI_NOT_GREEN)
        s = snap()
        s["checks"][0]["conclusion"] = "failure"
        self.assertEqual(h.classify(s)["state"], h.CI_NOT_GREEN)

    def test_new_unresolved_thread_after_approval_reopens(self):
        s = snap()
        s["threads"].append({"id": "T2", "isResolved": False, "comments": []})
        self.assertEqual(h.classify(s)["state"], h.FINDING_OPEN)

    def test_unverified_or_ambiguous_threads_fail_closed(self):
        self.assertEqual(h.classify(snap(threads_verified=False))["state"], h.BLOCKED_UNVERIFIED)
        self.assertEqual(h.classify(snap(threads_verified=None))["state"], h.BLOCKED_UNVERIFIED)
        s = snap(threads=[{"id": "T9", "comments": []}])
        self.assertEqual(h.classify(s)["state"], h.BLOCKED_UNVERIFIED)
        s = snap()
        s["pr"]["head_sha"] = "short"
        self.assertEqual(h.classify(s)["state"], h.BLOCKED_UNVERIFIED)

    def test_reviewer_without_resolve_permission_escalates(self):
        r = h.classify(snap(threads=unresolved(f"Fixed @ {HEAD}"), viewer_can_resolve=False))
        self.assertIn("REVIEWER_CANNOT_RESOLVE_ESCALATE_TO_OWNER", r["reasons"])

    def test_classify_does_not_mutate_input(self):
        s = snap(threads=unresolved())
        before = copy.deepcopy(s)
        h.classify(s)
        self.assertEqual(s, before)


class HandoffMessageTests(unittest.TestCase):
    def test_message_once_per_state_and_head(self):
        r = h.classify(snap(threads=unresolved(f"Fixed @ {HEAD}")))
        msg = h.handoff_message(r, [])
        self.assertIn(HEAD, msg)
        self.assertIn("T1", msg)
        self.assertIsNone(h.handoff_message(r, [{"body": msg}]))  # duplicate suppressed

    def test_changed_head_gets_new_message(self):
        r1 = h.classify(snap(threads=unresolved(f"Fixed @ {HEAD}")))
        s2 = snap(threads=unresolved(f"Fixed @ {OLD}"))
        s2["pr"]["head_sha"] = OLD
        r2 = h.classify(s2)
        m1 = h.handoff_message(r1, [])
        self.assertIsNotNone(h.handoff_message(r2, [{"body": m1}]))

    def test_no_message_when_nothing_to_hand_off(self):
        self.assertIsNone(h.handoff_message(h.classify(snap()), []))

    def test_never_emits_resolve_or_approve_action(self):
        msg = h.handoff_message(h.classify(snap(threads=unresolved())), [])
        self.assertIn("Nothing here is approval", msg)
        self.assertFalse(h.classify(snap(threads=unresolved()))["mark_owner_merge_ready"])


class FetchTests(unittest.TestCase):
    def test_missing_token_fails_closed_without_network(self):
        import os
        from unittest import mock
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(h.main(["--pr", "1"]), 2)

    def test_network_error_is_unverified(self):
        from unittest import mock
        from urllib.error import URLError
        with mock.patch.object(h, "urlopen", side_effect=URLError("down")):
            self.assertFalse(h.fetch_threads("o", "r", 1, "t")["threads_verified"])


if __name__ == "__main__":
    unittest.main()
