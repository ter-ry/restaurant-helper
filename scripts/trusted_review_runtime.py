"""Disabled-by-default trusted reviewer and verifier runtime (issue #286).

Glues the merged offline components together: ``trusted_review_attestation`` (#283: Ed25519
attestation, verifier, request planners) and ``trusted_review_evidence_collector`` (#285:
read-only evidence). It is run ONLY from ``.github/workflows/trusted-review.yml`` on ``main``.

Safety model (see docs/TRUSTED_REVIEW_RUNTIME_SETUP.md):
  * Nothing runs unless ``FLOWTALLY_TRUSTED_REVIEW_ENABLED`` is exactly ``true``; nothing is ever
    written to GitHub unless ``FLOWTALLY_TRUSTED_REVIEW_LIVE_WRITES`` is also exactly ``true``.
  * Reviewer and verifier are separate roles with separate Apps, tokens and keys. A role refuses to
    start if it can see the other role's secrets. This module never reads a PR-head checkout.
  * The reviewer never rubber-stamps: it approves only Tier 0 (docs-only) PRs, and only after the
    pinned, separately authenticated Codex review App has reported a completed review at the exact
    head with no unresolved findings. Then the real verifier is run against the planned review
    before anything is posted. Anything missing or ambiguous blocks (fail closed).
  * Secrets and tokens are never printed, logged or written to disk.

Transports are injected so the tests never touch the network; ``HttpTransport`` is the only code
that speaks HTTP, and only to https://api.github.com.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

try:
    import develop_merge_policy as policy
    import trusted_review_attestation as att
    import trusted_review_evidence_collector as col
except ImportError:  # pragma: no cover
    from scripts import develop_merge_policy as policy
    from scripts import trusted_review_attestation as att
    from scripts import trusted_review_evidence_collector as col

API = "https://api.github.com"
ENABLE_VARIABLE = att.KILL_SWITCH_VARIABLE
LIVE_WRITES_VARIABLE = "FLOWTALLY_TRUSTED_REVIEW_LIVE_WRITES"
ATTESTATION_TTL_SECONDS = 1800  # well under att.MAX_TTL_SECONDS
PHASE1_BASES = ("develop",)
ALLOWED_EVENTS = ("workflow_dispatch", "schedule")
# Controlled initial live acceptance (#270): live approval/check writes are limited to these explicitly
# targeted PRs on a manual workflow_dispatch. Scheduled and untargeted runs stay dry-run even when the
# live-writes variable is true. Widening this tuple is a reviewed code change, never a setting.
LIVE_ACCEPTANCE_PRS = (296,)
_SHA = re.compile(r"^[0-9a-f]{40}$")
_CODEX_STATE = re.compile(r"<!--\s*codex-review-state:v1\s+(\{.*?\})\s*-->", re.S)

REVIEWER_TOKEN_PERMISSIONS = {"pull_requests": "write", "contents": "read", "metadata": "read", "checks": "read",
                              "statuses": "read", "issues": "read", "actions_variables": "read", "actions": "read"}
VERIFIER_TOKEN_PERMISSIONS = {"checks": "write", "pull_requests": "read", "contents": "read", "metadata": "read",
                              "statuses": "read", "issues": "read", "actions_variables": "read", "actions": "read"}
REVIEWER_ONLY_SECRETS = ("FLOWTALLY_REVIEWER_APP_PRIVATE_KEY", "FLOWTALLY_REVIEWER_SIGNING_KEY")
VERIFIER_ONLY_SECRETS = ("FLOWTALLY_VERIFIER_APP_PRIVATE_KEY",)


class ConfigError(Exception):
    """Misconfiguration. Raised only after the switch is on, so an inactive repo never fails."""


# ---- switches ----

def enabled(env: Mapping[str, str]) -> bool:
    return env.get(ENABLE_VARIABLE) == "true"


def live_writes_enabled(env: Mapping[str, str]) -> bool:
    return enabled(env) and env.get(LIVE_WRITES_VARIABLE) == "true"


def live_target_allowed(env: Mapping[str, str], pr: int) -> bool:
    """Live writes need the switches AND a manual dispatch explicitly targeting an allowlisted PR."""
    return (live_writes_enabled(env) and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and isinstance(pr, int) and not isinstance(pr, bool) and pr in LIVE_ACCEPTANCE_PRS)


# ---- GitHub App authentication (stdlib HTTP + cryptography RS256; no third-party action) ----

def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def mint_app_jwt(app_id: int, private_key_pem: str, now: datetime) -> str:
    key = serialization.load_pem_private_key(private_key_pem.encode("ascii"), password=None)
    t = int(now.timestamp())
    head = _b64u(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
    body = _b64u(json.dumps({"iat": t - 60, "exp": t + 540, "iss": str(app_id)}, separators=(",", ":")).encode())
    sig = key.sign(f"{head}.{body}".encode("ascii"), padding.PKCS1v15(), hashes.SHA256())
    return f"{head}.{body}.{_b64u(sig)}"


class HttpTransport:
    """Real transport, used only by the workflow. Never logs headers, bodies or tokens."""

    def __init__(self, token: str, timeout: int = 20):
        self._token, self._timeout = token, timeout

    def _send(self, method: str, path: str, params: dict | None = None, body: Any = None) -> dict[str, Any]:
        if not path.startswith("/"):
            raise ValueError("path must be absolute")
        url = API + path + (("?" + urllib.parse.urlencode(params)) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self._token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "flowtally-trusted-review-runtime",
            "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:  # noqa: S310 - fixed https host
                status, headers, raw = resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as exc:
            status, headers, raw = exc.code, dict(exc.headers or {}), exc.read()
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = None
        return {"status": status, "headers": headers, "body": parsed}

    def get(self, path: str, params: dict | None = None) -> dict[str, Any]:
        return self._send("GET", path, params)

    def post(self, path: str, body: Any) -> dict[str, Any]:
        return self._send("POST", path, None, body)

    def graphql(self, query: str, variables: dict) -> dict[str, Any]:
        return self._send("POST", "/graphql", None, {"query": query, "variables": variables})


# GitHub's POST /app/installations/{id}/access_tokens `permissions` field has no key for repository
# Variables (live dry run 2026-11-12: 422 for "variables"; "actions_variables" is also unlisted), yet an
# installation token can read variables when the App holds Variables:read. So the token request carries
# NO permissions override (single repository only, inheriting the installed least-privilege App) and the
# granted permission map is verified against an exact allowlist below; anything extra or missing fails closed.
_LEVEL = {"read": 1, "write": 2, "admin": 3}
_VARIABLES_ALIASES = ("actions_variables", "variables")
_SAFE_KEY = re.compile(r"^[a-z_]{1,40}$")


def _normalize_granted(granted: Mapping[str, Any]) -> dict[str, Any]:
    out = dict(granted)
    for alias in _VARIABLES_ALIASES:
        if alias != "actions_variables" and alias in out:
            value = out.pop(alias)
            if "actions_variables" in out and _LEVEL.get(value, 99) <= _LEVEL.get(out["actions_variables"], 99):
                continue  # keep the higher (or unknown, i.e. stricter) of the two reported levels
            out["actions_variables"] = value
    return out


def granted_permission_problems(granted: Mapping[str, Any], expected: Mapping[str, str]) -> list[str]:
    """Exact allowlist: no granted key outside `expected`, none above its level, none missing."""
    problems = []
    for key, level in sorted(granted.items()):
        want = expected.get(key)
        if want is None or _LEVEL.get(level, 99) > _LEVEL[want]:
            problems.append("unexpected:" + (key if isinstance(key, str) and _SAFE_KEY.match(key) else "invalid_key"))
    for key, want in sorted(expected.items()):
        if _LEVEL.get(granted.get(key), 0) < _LEVEL[want]:
            problems.append(f"missing:{key}")
    return problems

# Fixed vocabulary only. Provider text is matched, never echoed, so nothing untrusted reaches the log.
_REFUSAL_PATTERNS = (
    ("jwt_invalid", ("jwt", "json web token", "could not be decoded", "expiration time", "issued at")),
    ("installation_not_updated", ("not granted", "accept", "pending", "has not been approved", "new permissions")),
    ("invalid_permissions", ("permission", "not a permitted key", "not permitted")),
    ("repo_scope_mismatch", ("repositor", "not accessible", "does not have access")),
)


def categorize_token_refusal(status: Any, body: Any) -> str:
    """Map an installation-token HTTP failure to a safe, allowlisted category (never provider text)."""
    if status == 401:
        return "unauthorized_app_jwt"
    if status == 404:
        return "installation_not_found"
    if status == 403:
        base = "forbidden"
    elif status == 422:
        base = "unprocessable"
    elif isinstance(status, int) and 500 <= status < 600:
        return "github_server_error"
    elif status == 429:
        return "rate_limited"
    else:
        return "unexpected_status"
    message = body.get("message") if isinstance(body, Mapping) else None
    text = message.lower() if isinstance(message, str) else ""
    for category, needles in _REFUSAL_PATTERNS:
        if any(n in text for n in needles):
            return f"{base}:{category}"
    return f"{base}:unclassified"


def _status_code(resp: Any) -> str:
    status = resp.get("status") if isinstance(resp, Mapping) else None
    return f"http_{status}" if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599 else "http_unknown"


def mint_installation_token(jwt_transport: Any, repository: str, expected: Mapping[str, str]) -> tuple[str, dict]:
    """Short-lived, single-repository token; returns (token, granted_permissions).

    No `permissions` override is sent (see the note above); the granted map must equal the `expected`
    allowlist or the call fails closed. Failures raise ConfigError("<step>:http_<status>:<category>") or a
    fixed-vocabulary reason built only from numeric status and fixed strings; never a JWT, token, header
    or response text.
    """
    owner, name = repository.split("/")
    inst = jwt_transport.get(f"/repos/{owner}/{name}/installation")
    if inst.get("status") != 200 or not isinstance(inst.get("body"), Mapping) or not isinstance(inst["body"].get("id"), int):
        raise ConfigError(f"app_installation_not_found:{_status_code(inst)}:{categorize_token_refusal(inst.get('status'), inst.get('body'))}")
    resp = jwt_transport.post(f"/app/installations/{inst['body']['id']}/access_tokens",
                              {"repositories": [name]})
    body = resp.get("body")
    if resp.get("status") != 201:
        reason = f"installation_token_refused:{_status_code(resp)}:{categorize_token_refusal(resp.get('status'), body)}"
        raise ConfigError(reason)
    if not isinstance(body, Mapping) or not isinstance(body.get("token"), str):
        raise ConfigError(f"installation_token_incomplete_response:{_status_code(resp)}")
    repos = body.get("repositories")
    if not isinstance(repos, list) or [r.get("full_name") for r in repos if isinstance(r, Mapping)] != [repository]:
        raise ConfigError("installation_token_not_single_repo")
    granted = body.get("permissions")
    if not isinstance(granted, Mapping):
        raise ConfigError("installation_token_permissions_unknown")
    granted = _normalize_granted(granted)
    bad = granted_permission_problems(granted, expected)
    if bad:
        raise ConfigError("installation_token_permissions_not_allowlisted:" + ",".join(bad))
    return body["token"], granted


def verifier_permission_problems(permissions: Any) -> list[str]:
    """The verifier may write checks only: no review, contents, merge, workflow or settings power."""
    if not isinstance(permissions, Mapping):
        return ["permissions_unknown"]
    out = [f"forbidden_write:{k}" for k, v in sorted(permissions.items()) if v in ("write", "admin") and k != "checks"]
    if permissions.get("checks") != "write":
        out.append("missing:checks_write")
    if permissions.get("actions_variables") != "read":
        out.append("missing:variables_read")
    return out


# ---- configuration ----

def _need(env: Mapping[str, str], name: str) -> str:
    v = env.get(name, "")
    if not v.strip():
        raise ConfigError(f"missing:{name}")
    return v


def _need_int(env: Mapping[str, str], name: str) -> int:
    v = _need(env, name)
    if not v.isdigit() or int(v) <= 0:
        raise ConfigError(f"invalid_int:{name}")
    return int(v)


def check_isolation(env: Mapping[str, str], role: str) -> None:
    """A role must not hold the other role's credentials (no shared secrets, design section 6)."""
    foreign = VERIFIER_ONLY_SECRETS if role == "reviewer" else REVIEWER_ONLY_SECRETS
    leaked = [n for n in foreign if env.get(n)]
    if leaked:
        raise ConfigError("cross_role_secret_present:" + ",".join(leaked))


def check_trusted_context(env: Mapping[str, str]) -> tuple[str, str]:
    """Only a main-branch workflow_dispatch/schedule run in the pinned repository may use secrets."""
    repo = _need(env, "GITHUB_REPOSITORY")
    if repo != policy.ALLOWED_REPOSITORY:
        raise ConfigError("wrong_repository")
    if env.get("GITHUB_REF") != "refs/heads/main":
        raise ConfigError("not_main_ref")
    if env.get("GITHUB_EVENT_NAME") not in ALLOWED_EVENTS:
        raise ConfigError("untrusted_event")
    sha = _need(env, "GITHUB_SHA")
    if not _SHA.match(sha):
        raise ConfigError("invalid_runtime_sha")
    return repo, sha


def load_signing_key(pem: str) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(pem.encode("ascii"), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ConfigError("signing_key_not_ed25519")
    return key


def load_public_key(b64: str) -> bytes:
    try:
        raw = base64.b64decode(b64, validate=True)
    except ValueError as exc:
        raise ConfigError("public_key_invalid") from exc
    if len(raw) != 32:
        raise ConfigError("public_key_invalid")
    return raw


def trusted_runtime_sha(read: Any, repository: str, runtime_sha: str) -> None:
    """The runtime SHA that gets signed/verified must be the current tip of main."""
    owner, name = repository.split("/")
    resp = read.get(f"/repos/{owner}/{name}/branches/main", {})
    tip = (((resp.get("body") or {}).get("commit") or {}).get("sha")) if resp.get("status") == 200 else None
    if tip != runtime_sha:
        raise ConfigError("runtime_sha_not_main_tip")


# ---- independent assessment (reviewer) ----

def codex_review_reasons(comments: Any, head: str, codex_bot_id: int, authors: set[str]) -> list[str]:
    """Accept the Codex review engine only via its pinned numeric bot id and exact-head completed state."""
    if not isinstance(comments, list):
        return ["codex_comments_missing"]
    found = []
    for c in comments:
        u = c.get("user") if isinstance(c, Mapping) else None
        if not isinstance(u, Mapping) or u.get("id") != codex_bot_id or u.get("type") != "Bot":
            continue  # a comment by anyone else (including the shared owner account) is never evidence
        m = _CODEX_STATE.search(c.get("body") or "")
        if m:
            found.append((str(c.get("updated_at", "")), m.group(1)))
    if not found:
        return ["codex_review_missing"]
    try:
        state = json.loads(sorted(found)[-1][1])
        cr = state["code_review"]
        sha, status, unresolved = cr["commit_sha"], cr["status"], cr["has_unresolved_findings"]
    except (ValueError, KeyError, TypeError):
        return ["codex_review_unreadable"]
    out = []
    if sha != head:
        out.append("codex_review_stale_head")
    if status != "completed":
        out.append("codex_review_not_completed")
    if unresolved is not False:
        out.append("codex_unresolved_findings")
    return out


def assess(ev: Mapping[str, Any], comments: Any, cfg: Mapping[str, Any]) -> list[str]:
    """Reasons the reviewer must NOT approve. Empty list means every reviewer-side gate passed."""
    if ev.get("incomplete") or ev.get("api_errors"):
        return ["incomplete_evidence"]
    if ev.get("unverified"):
        return ["base_sha_unproven"]  # never fabricate a base SHA
    out = []
    pr = ev["pr"]
    if pr.get("base", {}).get("ref") not in PHASE1_BASES:
        out.append("base_not_phase1")
    files = ev.get("changed_files") or []
    if not files or any(policy.classify_path(f) != "tier0" for f in files):
        out.append("not_tier0_only")  # migrations/finance/POS/security/workflows/anything else: owner only
    if any(str(f).lower().startswith(att._SELF_PROTECTED) for f in files):
        out.append("self_protected_path")
    threads = ev.get("threads")
    if not isinstance(threads, list) or any(not isinstance(t, Mapping) or t.get("is_resolved") is not True for t in threads):
        out.append("unresolved_threads")
    if ev.get("requested_reviewers"):
        out.append("pending_requested_reviewers")
    authors = {str(a).lower() for a in ev.get("commit_authors") or []} | {str((pr.get("user") or {}).get("login", "")).lower()}
    if cfg["codex_bot_login"].lower() in authors or cfg["bot_login"].lower() in authors:
        out.append("review_engine_is_author")
    out.extend(codex_review_reasons(comments, pr["head"]["sha"], cfg["codex_bot_id"], authors))
    return out


def _clock(now: Any) -> Callable[[], datetime]:
    """``now`` may be a fixed datetime (tests) or a callable returning the current time (production)."""
    return now if callable(now) else (lambda: now)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def build_payload(ev: Mapping[str, Any], cfg: Mapping[str, Any], now: datetime, nonce: str, session_id: str) -> dict[str, Any]:
    pr = ev["pr"]
    return {"repo_id": cfg["repo_id"], "pr": pr["number"], "head_sha": pr["head"]["sha"], "base_sha": pr["base"]["sha"],
            "changed_files_sha256": att.changed_files_digest(ev["changed_files"]), "reviewer_session_id": session_id,
            "author_session_ids": list(ev["author_session_ids"]), "nonce": nonce, "issued_at": _iso(now),
            "expires_at": _iso(now + timedelta(seconds=ATTESTATION_TTL_SECONDS)), "evaluator_main_sha": cfg["evaluator_main_sha"]}


def verifier_config(cfg: Mapping[str, Any]) -> dict[str, Any]:
    return {"bot_user_id": cfg["bot_user_id"], "bot_login": cfg["bot_login"], "repo_id": cfg["repo_id"],
            "repository": cfg["repository"], "allowed_bases": list(PHASE1_BASES), "public_key": cfg["public_key"],
            "evaluator_main_sha": cfg["evaluator_main_sha"], "verifier_app_id": cfg.get("verifier_app_id")}


def _snapshot(ev: Mapping[str, Any]) -> tuple:
    pr = ev["pr"]
    return (pr["head"]["sha"], pr["base"]["sha"], pr["state"], pr["draft"], att.changed_files_digest(ev.get("changed_files")))


def _out(pr: int, action: str, *reasons: str, **extra: Any) -> dict[str, Any]:
    return {"pr": pr, "action": action, "reasons": list(dict.fromkeys(reasons)), **extra}


def _comments(read: Any, repository: str, n: int) -> Any:
    owner, name = repository.split("/")
    items: list[Any] = []
    for page in range(1, col.MAX_PAGES + 1):
        resp = read.get(f"/repos/{owner}/{name}/issues/{n}/comments", {"per_page": col.PER_PAGE, "page": page})
        if resp.get("status") != 200 or not isinstance(resp.get("body"), list):
            return None
        items.extend(resp["body"])
        if len(resp["body"]) < col.PER_PAGE:
            return items
    return None  # truncated: fail closed


# ---- reviewer ----

def review_pr(n: int, *, env: Mapping[str, str], collector: Any, read: Any, post: Callable[[str, Any], Any] | None,
              cfg: Mapping[str, Any], key: Ed25519PrivateKey, now: Any, session_id: str,
              nonce: str | None = None) -> dict[str, Any]:
    """Independently assess one PR and (only when live writes are on) post one signed formal APPROVE."""
    if not enabled(env):
        return _out(n, "skipped", "kill_switch_off")
    clock = _clock(now)
    ev = collector.collect(n)
    if ev.get("incomplete"):
        return _out(n, "blocked", "incomplete_evidence", *ev.get("api_errors", []))
    if (ev.get("variables") or {}).get(ENABLE_VARIABLE) != "true":
        return _out(n, "skipped", "kill_switch_off")
    already = att.verify(ev, verifier_config(cfg), clock(), att.NonceStore())
    if already.verified:
        return _out(n, "skipped", "already_reviewed")  # idempotent: a valid unexpired approval exists for this head
    comments = _comments(read, cfg["repository"], n)
    blockers = assess(ev, comments, cfg)
    if blockers:
        return _out(n, "blocked", *blockers)
    now = clock()  # re-read the clock: authentication and collection above can take real time
    payload = build_payload(ev, cfg, now, nonce or secrets.token_hex(16), session_id)
    try:
        request = att.plan_review_submission(ev, verifier_config(cfg), payload, key, now)
    except (PermissionError, ValueError, KeyError) as exc:
        return _out(n, "blocked", f"plan_refused:{exc}")
    again = collector.collect(n)  # re-fetch right before writing: the final gates run on THIS evidence
    if again.get("incomplete") or _snapshot(again) != _snapshot(ev) or (again.get("variables") or {}).get(ENABLE_VARIABLE) != "true":
        return _out(n, "blocked", "changed_during_review")
    again_blockers = assess(again, comments, cfg)
    if again_blockers:
        return _out(n, "blocked", "changed_during_review", *again_blockers)
    # Run the real verifier over the review we are about to post, before posting anything.
    pre = dict(again)
    pre["reviews"] = list(again["reviews"]) + [{"id": 2 ** 31, "state": "APPROVED", "commit_id": payload["head_sha"],
                                             "submitted_at": _iso(now), "body": request["body"]["body"],
                                             "user": {"id": cfg["bot_user_id"], "login": cfg["bot_login"], "type": "Bot"}}]
    check = att.verify(pre, verifier_config(cfg), clock(), att.NonceStore())
    if not check.verified:
        return _out(n, "blocked", "preflight_verify_failed", *check.reasons)
    if not live_writes_enabled(env) or post is None:
        return _out(n, "dry_run", head_sha=payload["head_sha"], request={"path": request["path"], "commit_id": request["body"]["commit_id"],
                                                                      "event": request["body"]["event"], "attestation": payload})
    resp = post(request["path"].replace("{owner}/{repo}", cfg["repository"]), request["body"])
    body = resp.get("body") if isinstance(resp, Mapping) else None
    if not isinstance(resp, Mapping) or resp.get("status") != 200 or not isinstance(body, Mapping) \
            or body.get("commit_id") != payload["head_sha"] or body.get("state") != "APPROVED" \
            or (body.get("user") or {}).get("id") != cfg["bot_user_id"]:
        return _out(n, "error", "review_post_unconfirmed")
    return _out(n, "posted", head_sha=payload["head_sha"])


# ---- verifier ----

def _existing_check(read: Any, cfg: Mapping[str, Any], head: str) -> Any:
    owner, name = cfg["repository"].split("/")
    resp = read.get(f"/repos/{owner}/{name}/commits/{head}/check-runs",
                    {"check_name": att.CHECK_NAME, "app_id": cfg["verifier_app_id"], "per_page": 100})
    runs = (resp.get("body") or {}).get("check_runs") if resp.get("status") == 200 else None
    if not isinstance(runs, list):
        return None
    runs = [r for r in runs if isinstance(r, Mapping) and (r.get("app") or {}).get("id") == cfg["verifier_app_id"]]
    return max(runs, key=lambda r: (str(r.get("completed_at") or ""), r.get("id") or 0), default=None)


def verify_pr(n: int, *, env: Mapping[str, str], collector: Any, read: Any, post: Callable[[str, Any], Any] | None,
              cfg: Mapping[str, Any], now: Any) -> dict[str, Any]:
    """Verify one PR head and publish ``trusted-review-verified`` (success or failure, never neutral)."""
    if not enabled(env):
        return _out(n, "skipped", "kill_switch_off")
    first = collector.collect(n)
    head = ((first.get("pr") or {}).get("head") or {}).get("sha")
    if not (isinstance(head, str) and _SHA.match(head)):
        return _out(n, "blocked", "head_unknown", *first.get("api_errors", []))
    # The verdict is derived from a FRESH read taken right before publishing, never from the first read.
    ev = collector.collect(n)
    if ((ev.get("pr") or {}).get("head") or {}).get("sha") != head:
        return _out(n, "blocked", "changed_during_verification", head_sha=head)  # head moved: publish nothing
    now = _clock(now)()  # current time right after the fresh read, used for both verification and reuse checks
    result = att.verify(ev, verifier_config(cfg), now, att.NonceStore())
    request = att.plan_verifier_check(result, head, cfg["verifier_app_id"])
    verified = request["body"]["conclusion"] == "success"
    prior = _existing_check(read, cfg, head)
    if prior is not None:
        same_state = att.verify_check_source(prior, head, cfg["verifier_app_id"], now) == [] if verified else \
            (prior.get("conclusion") == "failure" and prior.get("output", {}).get("summary") == request["body"]["output"]["summary"])
        if same_state:
            return _out(n, "skipped", "check_already_published", head_sha=head, conclusion=request["body"]["conclusion"])
    if not live_writes_enabled(env) or post is None:
        return _out(n, "dry_run", head_sha=head, conclusion=request["body"]["conclusion"], reasons_found=list(result.reasons))
    path = request["path"].replace("{owner}/{repo}", cfg["repository"])
    resp = post(path, request["body"])
    body = resp.get("body") if isinstance(resp, Mapping) else None
    if not isinstance(resp, Mapping) or resp.get("status") != 201 or not isinstance(body, Mapping) \
            or (body.get("app") or {}).get("id") != cfg["verifier_app_id"] or body.get("head_sha") != head:
        return _out(n, "error", "check_post_unconfirmed", head_sha=head)
    return _out(n, "posted", head_sha=head, conclusion=request["body"]["conclusion"], reasons_found=list(result.reasons))


def revoke_pr(n: int, *, read: Any, post: Callable[[str, Any], Any] | None, cfg: Mapping[str, Any]) -> dict[str, Any]:
    """Switch is off: turn any still-published verifier SUCCESS into a failure. Writes failures only, never a success."""
    owner, name = cfg["repository"].split("/")
    resp = read.get(f"/repos/{owner}/{name}/pulls/{n}", {})
    head = ((resp.get("body") or {}).get("head") or {}).get("sha") if resp.get("status") == 200 else None
    if not (isinstance(head, str) and _SHA.match(head)):
        return _out(n, "blocked", "head_unknown")
    prior = _existing_check(read, cfg, head)
    if prior is None or prior.get("conclusion") != "success":
        return _out(n, "skipped", "nothing_to_revoke", head_sha=head)
    if post is None:
        return _out(n, "blocked", "live_writes_off", head_sha=head)
    request = att.plan_verifier_check(att.Result(att.REJECTED, ("kill_switch_off",)), head, cfg["verifier_app_id"])
    resp = post(request["path"].replace("{owner}/{repo}", cfg["repository"]), request["body"])
    body = resp.get("body") if isinstance(resp, Mapping) else None
    if not isinstance(resp, Mapping) or resp.get("status") != 201 or not isinstance(body, Mapping) \
            or (body.get("app") or {}).get("id") != cfg["verifier_app_id"] or body.get("head_sha") != head:
        return _out(n, "error", "revoke_unconfirmed", head_sha=head)
    return _out(n, "posted", "revoked_kill_switch_off", head_sha=head, conclusion="failure")


# ---- PR enumeration and CLI ----

def list_target_prs(read: Any, repository: str, repo_id: int) -> list[int]:
    owner, name = repository.split("/")
    out: list[int] = []
    for page in range(1, 6):
        resp = read.get(f"/repos/{owner}/{name}/pulls", {"state": "open", "base": PHASE1_BASES[0], "per_page": col.PER_PAGE, "page": page})
        if resp.get("status") != 200 or not isinstance(resp.get("body"), list):
            raise ConfigError("pr_listing_failed")
        for p in resp["body"]:
            hr = ((p.get("head") or {}).get("repo") or {}) if isinstance(p, Mapping) else {}
            if isinstance(p.get("number"), int) and hr.get("id") == repo_id:  # forks never get reviewed
                out.append(p["number"])
        if len(resp["body"]) < col.PER_PAGE:
            return sorted(out)
    raise ConfigError("pr_listing_truncated")


def coauthor_allowlist(env: Mapping[str, str]) -> tuple[str, ...]:
    """Owner-vetted non-account co-author emails (e.g. an AI assistant's noreply address), comma-separated."""
    return tuple(e.strip().lower() for e in env.get("TRUSTED_COAUTHOR_EMAILS", "").split(",") if e.strip())


def build_collector(http: Any, cfg: Mapping[str, Any], env: Mapping[str, str]) -> Any:
    return col.Collector(http, repository=cfg["repository"], repo_id=cfg["repo_id"], allowed_bases=PHASE1_BASES,
                         trusted_coauthor_emails=coauthor_allowlist(env))


def _targets(args: argparse.Namespace, read: Any, repository: str, repo_id: int) -> list[int]:
    if args.pr:
        return [args.pr]
    return list_target_prs(read, repository, repo_id)


def _common(env: Mapping[str, str], role: str, now: datetime) -> tuple[dict[str, Any], Any]:
    check_isolation(env, role)
    repository, sha = check_trusted_context(env)
    app_id = _need_int(env, "VERIFIER_APP_ID" if role == "verifier" else "FLOWTALLY_REVIEWER_APP_ID")
    cfg: dict[str, Any] = {"repository": repository, "repo_id": _need_int(env, "FLOWTALLY_REPO_ID"),
                           "evaluator_main_sha": sha, "bot_user_id": _need_int(env, "REVIEWER_BOT_USER_ID"),
                           "bot_login": _need(env, "REVIEWER_BOT_LOGIN")}
    jwt = mint_app_jwt(app_id, _need(env, f"FLOWTALLY_{role.upper()}_APP_PRIVATE_KEY"), now)
    token, granted = mint_installation_token(HttpTransport(jwt), repository, REVIEWER_TOKEN_PERMISSIONS if role == "reviewer" else VERIFIER_TOKEN_PERMISSIONS)
    problems = att.reviewer_permission_problems(granted) if role == "reviewer" else verifier_permission_problems(granted)
    if problems:
        raise ConfigError("token_permissions:" + ",".join(problems))
    http = HttpTransport(token)
    meta = http.get(f"/repos/{repository}")
    if meta.get("status") != 200 or (meta.get("body") or {}).get("id") != cfg["repo_id"]:
        raise ConfigError("repo_id_mismatch")
    trusted_runtime_sha(http, repository, sha)
    return cfg, (http, token, app_id)


def run(argv: list[str], env: Mapping[str, str], now: datetime | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("role", choices=("reviewer", "verifier"))
    ap.add_argument("--pr", type=int, default=0, help="explicit PR number; omit to reconcile all open develop PRs")
    args = ap.parse_args(argv)
    revoke_only = False
    if not enabled(env):
        # Only a verifier that has live credentials AND was live-enabled keeps a revocation path; otherwise inert.
        if args.role == "verifier" and env.get(LIVE_WRITES_VARIABLE) == "true" and env.get("FLOWTALLY_VERIFIER_APP_PRIVATE_KEY"):
            revoke_only = True
        else:
            print(json.dumps({"role": args.role, "action": "skipped", "reasons": ["kill_switch_off"]}))
            return 0
    clock = _clock(now) if now is not None else (lambda: datetime.now(timezone.utc))
    now = clock()
    secrets_seen: list[str] = []
    try:
        cfg, (http, token, app_id) = _common(env, args.role, now)
        secrets_seen = [token]
        collector = build_collector(http, cfg, env)
        poster = http.post if (live_target_allowed(env, args.pr) or revoke_only) else None
        results = []
        if revoke_only:
            cfg.update(verifier_app_id=app_id)
            for n in _targets(args, http, cfg["repository"], cfg["repo_id"]):
                results.append(revoke_pr(n, read=http, post=poster, cfg=cfg))
        elif args.role == "reviewer":
            cfg.update(codex_bot_id=_need_int(env, "FLOWTALLY_CODEX_BOT_USER_ID"), codex_bot_login=env.get("FLOWTALLY_CODEX_BOT_LOGIN", "chatgpt-codex-connector[bot]"),
                       public_key=bytes(load_signing_key(_need(env, "FLOWTALLY_REVIEWER_SIGNING_KEY")).public_key().public_bytes(
                           serialization.Encoding.Raw, serialization.PublicFormat.Raw)), verifier_app_id=None)
            key = load_signing_key(env["FLOWTALLY_REVIEWER_SIGNING_KEY"])
            session = f"trusted-review-runtime:{env.get('GITHUB_RUN_ID', '0')}:{env.get('GITHUB_RUN_ATTEMPT', '0')}"
            for n in _targets(args, http, cfg["repository"], cfg["repo_id"]):
                results.append(review_pr(n, env=env, collector=collector, read=http, post=poster, cfg=cfg, key=key, now=clock, session_id=session))
        else:
            cfg.update(public_key=load_public_key(_need(env, "FLOWTALLY_REVIEWER_PUBLIC_KEY")), verifier_app_id=app_id)
            for n in _targets(args, http, cfg["repository"], cfg["repo_id"]):
                results.append(verify_pr(n, env=env, collector=collector, read=http, post=poster, cfg=cfg, now=clock))
    except ConfigError as exc:
        print(json.dumps({"role": args.role, "action": "error", "reasons": [str(exc)]}))
        return 1
    except Exception as exc:  # noqa: BLE001 - never leak a traceback that could include request data
        print(json.dumps({"role": args.role, "action": "error", "reasons": [f"runtime_error:{type(exc).__name__}"]}))
        return 1
    text = json.dumps({"role": args.role, "live_writes": poster is not None, "results": results}, sort_keys=True)
    for s in secrets_seen:
        text = text.replace(s, "***")
    print(text)
    return 1 if any(r["action"] == "error" for r in results) else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(run(sys.argv[1:], os.environ))
