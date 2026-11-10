"""Offline Phase 1 reviewer-attestation and verifier components (issue #280).

Implements section 4, 6 and 11 of docs/TRUSTED_REVIEWER_APP_DESIGN.md as pure
functions over *supplied static evidence*. This module performs no network,
file or environment access, reads no secret, and posts nothing: the "adapters"
only build the request a trusted, owner-run environment would send. It is NOT
active, authorizes no merge, and proves nothing about live GitHub behavior.

Key handling: the reviewer helper receives an Ed25519 private key object from
its caller; the verifier only ever receives the raw 32-byte public key. The
module never loads a key from disk or environment.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

try:  # same-directory import when run as a script/test
    import develop_merge_policy as _policy
except ImportError:  # pragma: no cover
    from scripts import develop_merge_policy as _policy

VERIFIED = "VERIFIED"
REJECTED = "REJECTED"
CHECK_NAME = "trusted-review-verified"
KILL_SWITCH_VARIABLE = "FLOWTALLY_TRUSTED_REVIEW_ENABLED"
MAX_TTL_SECONDS = 3600
REQUIRED_CHECKS = ("backend", "frontend")
TRUSTED_CHECK_APP = "github-actions"
BODY_MARKER = "flowtally-trusted-review-attestation:v1"
_BODY_RE = re.compile(r"<!--\s*" + re.escape(BODY_MARKER) + r"\s+(\{.*?\})\s+sig:([A-Za-z0-9+/=_-]+)\s*-->", re.S)
_SHA = re.compile(r"^[0-9a-f]{40}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_ATTEST_FIELDS = ("repo_id", "pr", "head_sha", "base_sha", "changed_files_sha256", "reviewer_session_id",
                  "author_session_ids", "nonce", "issued_at", "expires_at", "evaluator_main_sha")
# The verifier, its tests and its docs gate themselves: changing them is never unattended.
_SELF_PROTECTED = ("scripts/trusted_review", "scripts/tests/test_trusted_review", "docs/trusted_review")
# Permissions that give a path to merge, deploy, workflow edit or self-vouching.
_FORBIDDEN_REVIEWER_WRITE = frozenset({"contents", "actions", "administration", "workflows", "secrets",
                                       "deployments", "checks", "statuses", "variables"})


@dataclass(frozen=True)
class Result:
    status: str
    reasons: tuple[str, ...] = field(default_factory=tuple)
    attestation: Mapping[str, Any] | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)  # informational only, never a rejection reason

    @property
    def verified(self) -> bool:
        return self.status == VERIFIED and not self.reasons


def _reject(*reasons: str, notes: tuple[str, ...] = ()) -> Result:
    return Result(REJECTED, tuple(dict.fromkeys(reasons)), None, notes)


# ---- canonical encoding, digests, signing (reviewer side) ----

def canonical_json(payload: Mapping[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def changed_files_digest(files: Any) -> str | None:
    """sha256 over the sorted, de-duplicated, validated changed-file list; None if any path is invalid."""
    if not isinstance(files, (list, tuple)) or not files:
        return None
    norm = []
    for f in files:
        if _policy.normalize_path(f) is None:
            return None
        norm.append(f)
    return hashlib.sha256("\n".join(sorted(set(norm))).encode("utf-8")).hexdigest()


def _ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.endswith("Z"):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def sign_attestation(private_key: Ed25519PrivateKey, payload: Mapping[str, Any]) -> str:
    """Reviewer-environment only. Returns the review-body block carrying payload and detached signature."""
    sig = base64.b64encode(private_key.sign(canonical_json(payload))).decode("ascii")
    return f"<!-- {BODY_MARKER} {canonical_json(payload).decode('ascii')} sig:{sig} -->"


def parse_review_body(body: Any) -> tuple[dict[str, Any], bytes] | None:
    """Strict: exactly one block, exact field set, correct types. None on anything else."""
    if not isinstance(body, str):
        return None
    blocks = _BODY_RE.findall(body)
    if len(blocks) != 1 or body.count(BODY_MARKER) != 1:
        return None
    raw, sig = blocks[0]
    try:
        payload = json.loads(raw)
        sigb = base64.b64decode(sig, validate=True)
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or set(payload) != set(_ATTEST_FIELDS) or len(sigb) != 64:
        return None
    if canonical_json(payload) != raw.encode("ascii", "ignore"):
        return None  # non-canonical encoding: refuse rather than guess
    return payload, sigb


def _shape_ok(p: Mapping[str, Any]) -> bool:
    ints = isinstance(p["repo_id"], int) and not isinstance(p["repo_id"], bool) and isinstance(p["pr"], int) and not isinstance(p["pr"], bool)
    shas = all(isinstance(p[k], str) and _SHA.match(p[k]) for k in ("head_sha", "base_sha", "evaluator_main_sha"))
    strs = all(isinstance(p[k], str) and p[k] for k in ("reviewer_session_id", "nonce"))
    authors = isinstance(p["author_session_ids"], list) and bool(p["author_session_ids"]) and all(isinstance(a, str) and a for a in p["author_session_ids"])
    return ints and shas and strs and authors and isinstance(p["changed_files_sha256"], str) and bool(_HEX64.match(p["changed_files_sha256"]))


# ---- replay protection (verifier-owned) ----

class NonceStore:
    """In-memory model of the verifier-owned nonce store. Consumption is Phase 2 (actuator) only."""

    def __init__(self) -> None:
        self._seen: dict[str, tuple[Any, ...]] = {}
        self._consumed: set[str] = set()

    @staticmethod
    def _key(p: Mapping[str, Any], sig: bytes) -> tuple[Any, ...]:
        return (p["repo_id"], p["pr"], p["head_sha"], p["base_sha"], hashlib.sha256(sig).hexdigest())

    def check(self, p: Mapping[str, Any], sig: bytes) -> str | None:
        """None if usable (new, or idempotent re-verification of the identical attestation); else a reason."""
        n = p["nonce"]
        if n in self._consumed:
            return "nonce_consumed"
        prior = self._seen.get(n)
        if prior is not None and prior != self._key(p, sig):
            return "replay"
        return None

    def record(self, p: Mapping[str, Any], sig: bytes) -> None:
        self._seen.setdefault(p["nonce"], self._key(p, sig))

    def consume(self, p: Mapping[str, Any], sig: bytes) -> str | None:
        reason = self.check(p, sig)
        if reason:
            return reason
        self._consumed.add(p["nonce"])
        return None


# ---- verifier ----

def _kill_switch(evidence: Mapping[str, Any]) -> str | None:
    variables = evidence.get("variables")
    if not isinstance(variables, Mapping) or KILL_SWITCH_VARIABLE not in variables:
        return "kill_switch_unreadable"  # e.g. token lacks Variables read: fail closed
    return None if variables[KILL_SWITCH_VARIABLE] == "true" else "kill_switch_off"


def verify(evidence: Any, config: Any, now: datetime, nonces: NonceStore | None) -> Result:
    """Verify one PR head. Any exception, missing field or ambiguity yields REJECTED (fail closed)."""
    if not isinstance(nonces, NonceStore):
        return _reject("nonce_store_required")  # replay protection must never be silently disabled
    try:
        return _verify(evidence, config, now, nonces)
    except Exception as exc:  # noqa: BLE001 - fail closed on anything unexpected
        return _reject(f"verifier_error:{type(exc).__name__}")


def _verify(ev: Any, cfg: Any, now: datetime, nonces: NonceStore) -> Result:
    if not isinstance(ev, Mapping) or not isinstance(cfg, Mapping) or now.tzinfo is None:
        return _reject("invalid_input")
    ks = _kill_switch(ev)
    if ks:
        return _reject(ks)
    for key in ("bot_user_id", "bot_login", "repo_id", "repository", "allowed_bases", "public_key", "evaluator_main_sha"):
        if not cfg.get(key):
            return _reject(f"config_missing:{key}")
    if ev.get("incomplete") or ev.get("api_errors"):
        return _reject("incomplete_evidence")

    reasons: list[str] = []
    pr = ev.get("pr")
    if not isinstance(pr, Mapping):
        return _reject("missing_pr")
    head = (pr.get("head") or {}).get("sha")
    base_sha = (pr.get("base") or {}).get("sha")
    if not (isinstance(head, str) and _SHA.match(head) and isinstance(base_sha, str) and _SHA.match(base_sha)):
        return _reject("invalid_pr_shas")

    # T7 unauthorized PR
    head_repo = (pr.get("head") or {}).get("repo") or {}
    if ev.get("repository") != cfg["repository"] or head_repo.get("full_name") != cfg["repository"] or head_repo.get("id") != cfg["repo_id"]:
        reasons.append("unauthorized_repository_or_fork")
    if pr.get("state") != "open" or pr.get("draft") is not False:
        reasons.append("pr_not_open_or_draft")
    if (pr.get("base") or {}).get("ref") not in cfg["allowed_bases"]:
        reasons.append("base_not_allowlisted")

    # T8 self-modifying gate / tier 2 and invalid paths
    files = ev.get("changed_files")
    digest = changed_files_digest(files)
    if digest is None:
        reasons.append("changed_files_invalid_or_missing")
    else:
        for f in files:
            if _policy.classify_path(f) == "tier2" or str(f).lower().startswith(_SELF_PROTECTED):
                reasons.append("self_modifying_or_tier2_path")
                break

    # T1/T6 find the qualifying formal review by pinned numeric bot id, never by name or comment
    reviews = ev.get("reviews")
    if not isinstance(reviews, list):
        return _reject(*reasons, "reviews_missing")
    bot_reviews = [r for r in reviews if isinstance(r, Mapping) and isinstance(r.get("user"), Mapping)
                   and r["user"].get("id") == cfg["bot_user_id"]]
    spoof = [r for r in reviews if isinstance(r, Mapping) and isinstance(r.get("user"), Mapping)
             and r["user"].get("id") != cfg["bot_user_id"] and str(r["user"].get("login", "")).lower().startswith(str(cfg["bot_login"]).lower().split("[")[0])]
    notes = ("spoofed_actor_ignored",) if spoof else ()  # never counted, and never a veto either
    if not bot_reviews:
        return _reject(*reasons, "missing_attestation", notes=notes)
    bot_reviews.sort(key=lambda r: (str(r.get("submitted_at", "")), r.get("id") if isinstance(r.get("id"), int) else 0))
    last = bot_reviews[-1]
    user = last["user"]
    if user.get("type") != "Bot" or user.get("login") != cfg["bot_login"]:
        reasons.append("bot_identity_mismatch")
    if last.get("state") != "APPROVED":
        reasons.append("latest_bot_review_not_approval")
    if last.get("commit_id") != head:
        reasons.append("stale_sha")

    parsed = parse_review_body(last.get("body"))
    if parsed is None:
        return _reject(*reasons, "missing_attestation")
    payload, sig = parsed
    if not _shape_ok(payload):
        return _reject(*reasons, "attestation_malformed")
    try:
        Ed25519PublicKey.from_public_bytes(bytes(cfg["public_key"])).verify(sig, canonical_json(payload))
    except (InvalidSignature, ValueError):
        return _reject(*reasons, "invalid_signature")

    # bindings (T4, T9, T12)
    if payload["repo_id"] != cfg["repo_id"]:
        reasons.append("wrong_repository")
    if payload["pr"] != pr.get("number"):
        reasons.append("wrong_pr")
    if payload["head_sha"] != head:
        reasons.append("stale_sha")
    if payload["base_sha"] != base_sha:
        reasons.append("stale_base")
    if digest is not None and payload["changed_files_sha256"] != digest:
        reasons.append("changed_code")
    if payload["evaluator_main_sha"] != cfg["evaluator_main_sha"]:
        reasons.append("evaluator_sha_mismatch")

    # T5 expiry
    issued, expires = _ts(payload["issued_at"]), _ts(payload["expires_at"])
    if issued is None or expires is None or expires <= issued or (expires - issued).total_seconds() > MAX_TTL_SECONDS:
        reasons.append("attestation_time_invalid")
    elif now < issued:
        reasons.append("attestation_from_future")
    elif now >= expires:
        reasons.append("expired_attestation")

    # T3 segregation: fail closed when authorship cannot be determined
    live_sessions = ev.get("author_session_ids")
    commit_authors = ev.get("commit_authors")
    authors = {str((pr.get("user") or {}).get("login", "")).lower(), *(str(a).lower() for a in commit_authors or [])}
    authors.discard("")
    pr_author = (pr.get("user") or {}).get("login")
    if (not isinstance(live_sessions, list) or not live_sessions or not authors
            or not isinstance(pr_author, str) or not pr_author
            or not isinstance(commit_authors, list) or not commit_authors
            or not all(isinstance(a, str) and a for a in commit_authors)):
        reasons.append("author_identity_undetermined")
    else:
        if set(live_sessions) != set(payload["author_session_ids"]):
            reasons.append("author_sessions_mismatch")
        if payload["reviewer_session_id"] in live_sessions or payload["reviewer_session_id"] in payload["author_session_ids"]:
            reasons.append("author_self_review")
        if str(user.get("login", "")).lower() in authors or str(user.get("login", "")).lower().removesuffix("[bot]") in authors:
            reasons.append("author_self_review")

    # T10 CI, T11 threads, pending reviewers
    reasons.extend(_ci_reasons(ev.get("check_runs"), head, base_sha))
    threads = ev.get("threads")
    if not isinstance(threads, list):
        reasons.append("threads_missing")
    elif any(not isinstance(t, Mapping) or t.get("is_resolved") is not True for t in threads):
        reasons.append("unresolved_threads")
    pending = ev.get("requested_reviewers")
    if not isinstance(pending, list) or pending:
        reasons.append("pending_requested_reviewers")

    # T12 replay (idempotent for the identical attestation and binding)
    nonce_reason = nonces.check(payload, sig)
    if nonce_reason:
        reasons.append(nonce_reason)

    if reasons:
        return _reject(*reasons)
    nonces.record(payload, sig)
    return Result(VERIFIED, (), payload, notes)


def _ci_reasons(runs: Any, head: str, base: str) -> list[str]:
    if not isinstance(runs, list):
        return ["ci_missing"]
    out = []
    for name in REQUIRED_CHECKS:
        match = [r for r in runs if isinstance(r, Mapping) and r.get("name") == name and r.get("head_sha") == head
                 and r.get("base_sha") == base and (r.get("app") or {}).get("slug") == TRUSTED_CHECK_APP]
        if not match:
            out.append(f"ci_missing:{name}")
        elif any(r.get("status") != "completed" or r.get("conclusion") != "success" for r in match):
            out.append(f"failed_ci:{name}")
    return out


# ---- dry-run adapters (build requests only; nothing is sent) ----

def plan_verifier_check(result: Result, head_sha: str, verifier_app_id: int) -> dict[str, Any]:
    """Request a verifier-identity environment would POST to /check-runs. Conclusion is success or failure only."""
    if not (isinstance(head_sha, str) and _SHA.match(head_sha)):
        raise ValueError("head_sha must be a 40-hex SHA")
    ok = result.verified and result.attestation is not None
    if ok and result.attestation["head_sha"] != head_sha:
        raise ValueError("head_sha does not match the verified attestation")  # never vouch for an unreviewed commit
    summary = {"verifier_app_id": verifier_app_id, "reasons": list(result.reasons)}
    if ok:
        summary["expires_at"] = result.attestation["expires_at"]
    return {"method": "POST", "path": "/repos/{owner}/{repo}/check-runs",
            "body": {"name": CHECK_NAME, "head_sha": head_sha, "status": "completed",
                     "conclusion": "success" if ok else "failure",  # never neutral/skipped
                     "output": {"title": "trusted review verified" if ok else "trusted review NOT verified",
                                "summary": json.dumps(summary, sort_keys=True)}}}


def verify_check_source(check_run: Any, head_sha: str, verifier_app_id: int, now: datetime) -> list[str]:
    """Actuator/ruleset-side model: a stored check only counts if made by the verifier App, for this head, unexpired."""
    if not isinstance(check_run, Mapping):
        return ["check_missing"]
    out = []
    if check_run.get("name") != CHECK_NAME:
        out.append("check_wrong_name")
    if (check_run.get("app") or {}).get("id") != verifier_app_id:
        out.append("check_not_from_verifier")
    if check_run.get("head_sha") != head_sha:
        out.append("check_wrong_head")
    if check_run.get("status") != "completed" or check_run.get("conclusion") != "success":
        out.append("check_not_success")
    try:
        exp = _ts(json.loads((check_run.get("output") or {}).get("summary", "")).get("expires_at"))
    except (ValueError, AttributeError):
        exp = None
    if exp is None or now >= exp:
        out.append("check_expired_or_unbound")
    return out


def plan_review_submission(evidence: Any, config: Any, payload: Mapping[str, Any], private_key: Ed25519PrivateKey,
                           now: datetime) -> dict[str, Any]:
    """Reviewer-environment dry run: refuse unless safe, else build the formal-review request for the exact head."""
    if not isinstance(evidence, Mapping) or not isinstance(config, Mapping):
        raise ValueError("invalid_input")
    ks = _kill_switch(evidence)
    if ks:
        raise PermissionError(ks)
    pr = evidence["pr"]
    head, base = pr["head"]["sha"], pr["base"]["sha"]
    if (payload.get("head_sha"), payload.get("base_sha"), payload.get("pr")) != (head, base, pr.get("number")):
        raise ValueError("payload_does_not_match_live_pr")
    if not _shape_ok(payload) or set(payload) != set(_ATTEST_FIELDS):
        raise ValueError("payload_malformed")
    if payload["changed_files_sha256"] != changed_files_digest(evidence.get("changed_files")):
        raise ValueError("payload_changed_files_mismatch")
    issued, expires = _ts(payload["issued_at"]), _ts(payload["expires_at"])
    if issued is None or expires is None or not (issued <= now < expires) or (expires - issued).total_seconds() > MAX_TTL_SECONDS:
        raise ValueError("payload_time_invalid")
    live = evidence.get("author_session_ids")
    if not isinstance(live, list) or not live or not all(isinstance(a, str) and a for a in live):
        raise PermissionError("author_identity_undetermined")
    if set(live) != set(payload["author_session_ids"]):
        raise PermissionError("author_sessions_mismatch")
    if payload["reviewer_session_id"] in live:
        raise PermissionError("author_self_review")
    commit_authors = evidence.get("commit_authors")
    if (not isinstance(commit_authors, list) or not commit_authors or not all(isinstance(a, str) and a for a in commit_authors)
            or not (pr.get("user") or {}).get("login")):
        raise PermissionError("author_identity_undetermined")
    bot = str(config.get("bot_login", "")).lower()
    names = {str(a).lower() for a in commit_authors} | {str(pr["user"]["login"]).lower()}
    if not bot or bot in names or bot.removesuffix("[bot]") in names:
        raise PermissionError("author_self_review")
    return {"method": "POST", "path": f"/repos/{{owner}}/{{repo}}/pulls/{pr['number']}/reviews",
            "body": {"commit_id": head, "event": "APPROVE", "body": sign_attestation(private_key, payload)}}


def reviewer_permission_problems(permissions: Any) -> list[str]:
    """Model of design section 6/T13: the reviewer token must have no merge/deploy/check-vouching power."""
    if not isinstance(permissions, Mapping):
        return ["permissions_unknown"]
    out = [f"forbidden_write:{k}" for k, v in sorted(permissions.items()) if k in _FORBIDDEN_REVIEWER_WRITE and v == "write"]
    if permissions.get("pull_requests") != "write":
        out.append("missing:pull_requests_write")
    if permissions.get("variables") not in ("read",):
        out.append("missing:variables_read")
    return out
