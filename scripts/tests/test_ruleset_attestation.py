import copy
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ruleset_attestation as a
import ruleset_observer as observer
import develop_automerge_controller as controller
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)
DETAIL = {"enforcement": "active", "bypass_actors": []}
BRANCHES = {b: {"rules": [{"ruleset_id": i}], "rulesets": {str(i): copy.deepcopy(DETAIL)}}
            for b, i in (("main", 1), ("develop", 2))}


class AttestationTests(unittest.TestCase):
    def setUp(self):
        self.private = Ed25519PrivateKey.generate()
        self.public = self.private.public_key()
        self.doc = a.sign(repository="ter-ry/restaurant-helper", observer_app_id=99,
                           branches=BRANCHES, now=NOW, private_key=self.private)

    def check(self, doc=None, **kw):
        return a.verify(doc or self.doc, public_key=self.public, repository="ter-ry/restaurant-helper",
                        observer_app_id=99, now=NOW, **kw)

    def test_valid_short_lived_empty_bypass_evidence(self):
        self.assertEqual(self.check(), (True, "OK"))

    def test_signature_provenance_and_expiry_fail_closed(self):
        doc = copy.deepcopy(self.doc); doc["payload"]["repository"] = "evil/x"
        self.assertEqual(self.check(doc), (False, "ATTESTATION_SIGNATURE_INVALID"))
        expired = a.sign(repository="ter-ry/restaurant-helper", observer_app_id=99, branches=BRANCHES,
                          now=NOW - timedelta(seconds=1000), private_key=self.private)
        self.assertEqual(self.check(expired), (False, "ATTESTATION_EXPIRED_OR_STALE"))

    def test_nonempty_bypass_is_rejected_even_if_signed(self):
        altered = copy.deepcopy(BRANCHES)
        altered["main"]["rulesets"]["1"]["bypass_actors"] = [{"actor_id": 1}]
        doc = a.sign(repository="ter-ry/restaurant-helper", observer_app_id=99, branches=altered, now=NOW, private_key=self.private)
        self.assertEqual(self.check(doc), (False, "ATTESTATION_BYPASS_ACTORS_NONEMPTY"))

    def test_changed_ruleset_set_is_rejected(self):
        altered = copy.deepcopy(BRANCHES); altered["main"]["rulesets"]["2"] = copy.deepcopy(DETAIL)
        doc = a.sign(repository="ter-ry/restaurant-helper", observer_app_id=99, branches=altered, now=NOW, private_key=self.private)
        self.assertEqual(self.check(doc), (False, "ATTESTATION_RULESET_SET_INVALID"))

    def test_multiple_rules_may_reference_one_ruleset(self):
        altered = copy.deepcopy(BRANCHES)
        altered["main"]["rules"].append({"type": "deletion", "ruleset_id": 1})
        doc = a.sign(repository="ter-ry/restaurant-helper", observer_app_id=99, branches=altered, now=NOW, private_key=self.private)
        self.assertEqual(self.check(doc), (True, "OK"))

    def test_observer_deduplicates_repeated_ruleset_detail_reads(self):
        rules = [{"type": "pull_request", "ruleset_id": 1}, {"type": "deletion", "ruleset_id": 1}]
        responses = {"/repos/ter-ry/restaurant-helper/rules/branches/main": rules,
                     "/repos/ter-ry/restaurant-helper/rulesets/1": copy.deepcopy(DETAIL),
                     "/repos/ter-ry/restaurant-helper/rules/branches/develop": [{"ruleset_id": 2}],
                     "/repos/ter-ry/restaurant-helper/rulesets/2": copy.deepcopy(DETAIL)}
        calls = []
        original = observer._get
        observer._get = lambda token, path: (calls.append(path) or responses[path.split("?", 1)[0]])
        try:
            result = observer.collect("ter-ry/restaurant-helper", "token")
        finally:
            observer._get = original
        self.assertEqual(len([p for p in calls if p.endswith("/rulesets/1")]), 1)
        self.assertEqual(result["main"]["rulesets"], {"1": DETAIL})

    def test_observer_rejects_a_truncated_full_page(self):
        full_page = [{"ruleset_id": i} for i in range(100)]
        original = observer._get
        observer._get = lambda token, path: full_page
        try:
            with self.assertRaisesRegex(RuntimeError, "observer_rules_truncated"):
                observer.collect("ter-ry/restaurant-helper", "token")
        finally:
            observer._get = original

    def test_expiry_is_rechecked_for_the_final_write_gate(self):
        self.assertTrue(a.is_unexpired(self.doc, NOW))
        self.assertFalse(a.is_unexpired(self.doc, NOW + timedelta(seconds=901)))

    def test_guarded_transport_refuses_expired_attestation_before_put(self):
        expired = a.sign(repository="ter-ry/restaurant-helper", observer_app_id=99, branches=BRANCHES,
                          now=NOW - timedelta(seconds=1000), private_key=self.private)

        class Inner:
            def __init__(self):
                self.puts = []

            def put(self, path, body):
                self.puts.append((path, body))

        inner = Inner()
        transport = controller.GuardedTransport(inner, "ter-ry/restaurant-helper", expired)
        with self.assertRaisesRegex(PermissionError, "RULESET_ATTESTATION_EXPIRED"):
            transport.put("/repos/ter-ry/restaurant-helper/pulls/1/merge",
                          {"sha": "a" * 40, "merge_method": "squash"})
        self.assertEqual(inner.puts, [])


if __name__ == "__main__":
    unittest.main()
