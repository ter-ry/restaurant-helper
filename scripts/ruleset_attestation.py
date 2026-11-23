"""Signed, short-lived ruleset evidence exchanged between the observer and merger.

The observer is the only component that may hold a ruleset-write-capable credential.  The
merger receives only this document and a public key, and therefore cannot turn a redacted
ruleset response into an empty bypass list.
"""
from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

VERSION = 1
MAX_TTL_SECONDS = 900
BRANCHES = ("main", "develop")


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(value: Any) -> bytes | None:
    if not isinstance(value, str):
        return None
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception:
        return None


def canonical(payload: Mapping[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def sign(*, repository: str, observer_app_id: int, branches: Mapping[str, Any], now: datetime,
         private_key: Ed25519PrivateKey, ttl_seconds: int = MAX_TTL_SECONDS) -> dict[str, Any]:
    if set(branches) != set(BRANCHES) or not isinstance(observer_app_id, int) or isinstance(observer_app_id, bool):
        raise ValueError("invalid_attestation_input")
    issued = now.astimezone(timezone.utc).replace(microsecond=0)
    expires = issued + timedelta(seconds=ttl_seconds)
    payload = {"version": VERSION, "repository": repository, "observer_app_id": observer_app_id,
               "issued_at": issued.isoformat().replace("+00:00", "Z"),
               "expires_at": expires.isoformat().replace("+00:00", "Z"),
               "branches": {b: branches[b] for b in BRANCHES}}
    return {"payload": payload, "signature": _b64(private_key.sign(canonical(payload)))}


def _time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def verify(document: Any, *, public_key: Ed25519PublicKey, repository: str, observer_app_id: int,
           now: datetime, max_future_skew: int = 30) -> tuple[bool, str]:
    if not isinstance(document, Mapping) or set(document) != {"payload", "signature"}:
        return False, "ATTESTATION_SHAPE_INVALID"
    payload, sig = document.get("payload"), _unb64(document.get("signature"))
    if not isinstance(payload, Mapping) or sig is None:
        return False, "ATTESTATION_SIGNATURE_INVALID"
    try:
        public_key.verify(sig, canonical(payload))
    except (InvalidSignature, ValueError, TypeError):
        return False, "ATTESTATION_SIGNATURE_INVALID"
    if payload.get("version") != VERSION or payload.get("repository") != repository \
            or payload.get("observer_app_id") != observer_app_id:
        return False, "ATTESTATION_PROVENANCE_INVALID"
    if set(payload.get("branches", {})) != set(BRANCHES):
        return False, "ATTESTATION_BRANCH_SET_INVALID"
    issued, expires = _time(payload.get("issued_at")), _time(payload.get("expires_at"))
    current = now.astimezone(timezone.utc)
    if issued is None or expires is None or expires <= issued:
        return False, "ATTESTATION_TIME_INVALID"
    age = (expires - issued).total_seconds()
    if age > MAX_TTL_SECONDS or issued > current + timedelta(seconds=max_future_skew) or expires <= current:
        return False, "ATTESTATION_EXPIRED_OR_STALE"
    for branch in BRANCHES:
        evidence = payload["branches"].get(branch)
        if not isinstance(evidence, Mapping) or not isinstance(evidence.get("rules"), list) \
                or not isinstance(evidence.get("rulesets"), Mapping) or not evidence["rules"]:
            return False, "ATTESTATION_RULES_INVALID"
        ids = {r.get("ruleset_id") for r in evidence["rules"] if isinstance(r, Mapping)}
        if len(ids) != len(evidence["rules"]) or any(not isinstance(i, int) or isinstance(i, bool) for i in ids):
            return False, "ATTESTATION_RULES_INVALID"
        if set(evidence["rulesets"]) != {str(i) for i in ids}:
            return False, "ATTESTATION_RULESET_SET_INVALID"
        for detail in evidence["rulesets"].values():
            if not isinstance(detail, Mapping) or detail.get("enforcement") != "active" \
                    or not isinstance(detail.get("bypass_actors"), list):
                return False, "ATTESTATION_RULESET_DETAIL_INVALID"
            if detail["bypass_actors"]:
                return False, "ATTESTATION_BYPASS_ACTORS_NONEMPTY"
    return True, "OK"
