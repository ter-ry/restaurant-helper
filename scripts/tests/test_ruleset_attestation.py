import copy
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ruleset_attestation as a
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


if __name__ == "__main__":
    unittest.main()
