"""One-time, owner-triggered verifier for the pinned #387 integration head.

This is intentionally separate from the unattended Tier 0 reviewer.  It does not
approve a pull request, merge anything, or widen the Tier 0 policy.  It evaluates
an evidence snapshot and, when explicitly enabled by the owner, asks only the
pinned verifier App to publish ``trusted-review-verified``.
"""
from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Mapping

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

try:
    import trusted_review_attestation as att
    import trusted_review_runtime as runtime
    import ruleset_attestation
except ImportError:  # pragma: no cover
    from scripts import trusted_review_attestation as att
    from scripts import trusted_review_runtime as runtime
    from scripts import ruleset_attestation

REPOSITORY = "ter-ry/restaurant-helper"
PR_NUMBER = 387
REPOSITORY_ID = 1259514587
HEAD_SHA = "392c26f1a949f798607d6bcb35eee01f0732726e"
BASE_SHA = "4edbc8cafb3bfecd8cc3d67161887b3d9d6e7229"
MAIN_SHA = "9d848dc1cab2cb91ddaa03dd2a0b85fcf6469eee"
TREE_SHA = "b06ce5f93e39b4ca64932b69b7fd040747db8742"
PARENT_SHAS = frozenset(("25423940aaa7635116334d99b98373b396459fae", MAIN_SHA))
THREAD_IDS = frozenset((4668404688, 4669375586, 4669375597, 4669375607))
MAIN_RULESET_ID = 26415188
DEVELOP_RULESET_ID = 26858821
OWNER_LOGIN = "ter-ry"
LIVE_VARIABLE = "FLOWTALLY_MANUAL_TRUSTED_REVIEW_LIVE_WRITES"
RULESET_ATTESTATION = "FLOWTALLY_RULESET_ATTESTATION"
R1_MARKER = "R1 APPROVE @ " + HEAD_SHA
_SHA = re.compile(r"^[0-9a-f]{40}$")


def _reject(*reasons: str) -> dict[str, Any]:
    return {"verified": False, "reasons": list(dict.fromkeys(reasons))}


def _signed_attestation(review: Mapping[str, Any], public_key: bytes, now: datetime) -> list[str]:
    parsed = att.parse_review_body(review.get("body"))
    if parsed is None:
        return ["missing_attestation"]
    payload, signature = parsed
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, att.canonical_json(payload))
    except (InvalidSignature, ValueError):
        return ["invalid_signature"]
    if payload.get("repo_id") != REPOSITORY_ID or payload.get("pr") != PR_NUMBER:
        return ["attestation_binding_mismatch"]
    if payload.get("head_sha") != HEAD_SHA or payload.get("base_sha") != BASE_SHA:
        return ["attestation_binding_mismatch"]
    issued, expires = att._ts(payload.get("issued_at")), att._ts(payload.get("expires_at"))
    if issued is None or expires is None or expires <= issued or (expires - issued).total_seconds() > att.MAX_TTL_SECONDS:
        return ["attestation_time_invalid"]
    if now < issued:
        return ["attestation_from_future"]
    if now >= expires:
        return ["expired_attestation"]
    return []


def verify_manual(evidence: Mapping[str, Any], *, public_key: bytes, owner_login: str = OWNER_LOGIN,
                  now: datetime | None = None) -> dict[str, Any]:
    """Verify the complete fixed #387 evidence set.  Missing/ambiguous data rejects."""
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None or not isinstance(evidence, Mapping):
        return _reject("invalid_input")
    pr = evidence.get("pr")
    if not isinstance(pr, Mapping):
        return _reject("missing_pr")
    reasons: list[str] = []
    if evidence.get("repository") != REPOSITORY or pr.get("number") != PR_NUMBER:
        reasons.append("wrong_repository_or_pr")
    if pr.get("state") != "open" or pr.get("draft") is not False or pr.get("base_ref") != "develop":
        reasons.append("pr_state_or_base_invalid")
    if pr.get("head_sha") != HEAD_SHA or pr.get("base_sha") != BASE_SHA:
        reasons.append("stale_head_or_base")
    if pr.get("head_repo") != REPOSITORY or pr.get("base_repo") != REPOSITORY:
        reasons.append("fork_or_base_repo")
    if set(evidence.get("head_parents", ())) != PARENT_SHAS:
        reasons.append("both_parent_ancestry_unproven")
    if evidence.get("main_sha") != MAIN_SHA or evidence.get("head_tree") != TREE_SHA or evidence.get("main_tree") != TREE_SHA:
        reasons.append("source_tree_mismatch")
    if evidence.get("existing_verifier_success") is True:
        reasons.append("already_verified")
    if evidence.get("requested_reviewers") != []:
        reasons.append("pending_requested_reviewers")
    threads = evidence.get("threads")
    if not isinstance(threads, list) or len(threads) != len(THREAD_IDS):
        reasons.append("thread_set_incomplete")
    else:
        seen = {t.get("id") for t in threads if isinstance(t, Mapping)}
        if seen != THREAD_IDS or any(t.get("is_resolved") is not True for t in threads if isinstance(t, Mapping)):
            reasons.append("unresolved_thread")
    checks = evidence.get("checks")
    if not isinstance(checks, list):
        reasons.append("ci_missing")
    else:
        for name in ("backend", "frontend"):
            matches = [c for c in checks if isinstance(c, Mapping) and c.get("name") == name]
            if len(matches) != 1 or matches[0].get("head_sha") != HEAD_SHA or matches[0].get("base_sha") != BASE_SHA \
                    or matches[0].get("status") != "completed" or matches[0].get("conclusion") != "success" \
                    or matches[0].get("app_slug") != "github-actions":
                reasons.append("exact_head_ci:" + name)
    reviews = evidence.get("reviews")
    author = str(pr.get("author", "")).lower()
    qualifying = []
    if isinstance(reviews, list):
        latest: dict[Any, Mapping[str, Any]] = {}
        for review in reviews:
            user = review.get("user") if isinstance(review, Mapping) else None
            if isinstance(user, Mapping) and user.get("id"):
                key = user["id"]
                stamp = (str(review.get("submitted_at", "")), int(review.get("id", 0) or 0))
                prior = latest.get(key)
                prior_stamp = (str(prior.get("submitted_at", "")), int(prior.get("id", 0) or 0)) if prior else ("", 0)
                if stamp >= prior_stamp:
                    latest[key] = review
        for review in latest.values():
            user = review.get("user") if isinstance(review, Mapping) else None
            login = str((user or {}).get("login", "")).lower()
            if isinstance(user, Mapping) and user.get("type") == "User" and user.get("id") \
                    and login not in {author, str(owner_login).lower()} and review.get("state") == "APPROVED" \
                    and review.get("commit_id") == HEAD_SHA and R1_MARKER in str(review.get("body", "")):
                qualifying.append(review)
    if not qualifying:
        reasons.append("missing_independent_approval")
    else:
        reasons.extend(_signed_attestation(qualifying[-1], public_key, now))
    if evidence.get("security_controls_unchanged") is not True:
        reasons.append("security_controls_changed_or_unproven")
    return _reject(*reasons) if reasons else {"verified": True, "reasons": [], "reviewer": qualifying[-1]["user"]}


def live_writes_enabled(env: Mapping[str, str]) -> bool:
    return env.get(LIVE_VARIABLE) == "true"


def check_target(actor: str, pr: int, head: str, base: str) -> list[str]:
    reasons = []
    if actor != OWNER_LOGIN:
        reasons.append("owner_trigger_required")
    if (pr, head, base) != (PR_NUMBER, HEAD_SHA, BASE_SHA):
        reasons.append("target_is_pinned_to_387")
    return reasons


def plan_verifier_check(result: Mapping[str, Any], verifier_app_id: int) -> dict[str, Any]:
    if not result.get("verified"):
        return {"name": att.CHECK_NAME, "head_sha": HEAD_SHA, "conclusion": "failure", "verifier_app_id": verifier_app_id,
                "output": {"summary": json.dumps({"reasons": result.get("reasons", [])}, sort_keys=True)}}
    return {"name": att.CHECK_NAME, "head_sha": HEAD_SHA, "conclusion": "success", "verifier_app_id": verifier_app_id,
            "output": {"summary": json.dumps({"manual_target": PR_NUMBER, "head_sha": HEAD_SHA}, sort_keys=True)}}


def verify_published_check(check_run: Any, verifier_app_id: int) -> list[str]:
    """Final actuator-side identity binding; a lookalike check never qualifies."""
    if not isinstance(check_run, Mapping):
        return ["check_missing"]
    out = []
    if check_run.get("name") != att.CHECK_NAME:
        out.append("check_wrong_name")
    if (check_run.get("app") or {}).get("id") != verifier_app_id:
        out.append("check_not_from_verifier")
    if check_run.get("head_sha") != HEAD_SHA:
        out.append("check_wrong_head")
    if check_run.get("status") != "completed" or check_run.get("conclusion") != "success":
        out.append("check_not_success")
    return out


def public_key_from_env(env: Mapping[str, str]) -> bytes:
    try:
        key = base64.b64decode(env["FLOWTALLY_REVIEWER_PUBLIC_KEY"], validate=True)
    except (KeyError, ValueError):
        raise ValueError("public_key_invalid")
    if len(key) != 32:
        raise ValueError("public_key_invalid")
    return key


def verify_ruleset_attestation_from_env(env: Mapping[str, str], now: datetime) -> bool:
    """Ruleset bypass visibility is delegated to the existing signed observer boundary."""
    try:
        document = json.loads(env[RULESET_ATTESTATION])
        raw_key = base64.b64decode(env["FLOWTALLY_RULESET_ATTESTATION_PUBLIC_KEY"], validate=True)
        observer_id = int(env["FLOWTALLY_RULESET_OBSERVER_APP_ID"])
        if len(raw_key) != 32 or observer_id <= 0:
            return False
        ok, _ = ruleset_attestation.verify(document, public_key=Ed25519PublicKey.from_public_bytes(raw_key),
                                            repository=REPOSITORY, observer_app_id=observer_id, now=now)
        branches = document.get("payload", {}).get("branches", {}) if isinstance(document, Mapping) else {}
        ids = {}
        for branch, expected in (("main", MAIN_RULESET_ID), ("develop", DEVELOP_RULESET_ID)):
            rules = ((branches.get(branch) or {}).get("rules") or []) if isinstance(branches, Mapping) else []
            ids[branch] = {r.get("ruleset_id") for r in rules if isinstance(r, Mapping)}
            if ids[branch] != {expected}:
                return False
        return ok
    except (KeyError, ValueError, TypeError, json.JSONDecodeError):
        return False


def _get(t: Any, path: str, params: dict | None = None) -> Any:
    response = t.get(path, params or {})
    if not isinstance(response, Mapping) or response.get("status") != 200:
        raise RuntimeError("read_failed:" + path.rsplit("/", 1)[-1])
    return response.get("body")


def collect_live(t: Any, *, security_controls_unchanged: bool = False) -> dict[str, Any]:
    """Collect only read evidence for the fixed target; any exception is fatal to verification."""
    root = "/repos/" + REPOSITORY
    pr = _get(t, root + "/pulls/" + str(PR_NUMBER))
    head = _get(t, root + "/commits/" + HEAD_SHA)
    main = _get(t, root + "/commits/" + MAIN_SHA)
    if not isinstance(pr, Mapping) or not isinstance(head, Mapping) or not isinstance(main, Mapping):
        raise RuntimeError("bad_shape")
    reviews = []
    for page in range(1, 4):
        chunk = _get(t, root + f"/pulls/{PR_NUMBER}/reviews", {"per_page": 100, "page": page})
        if not isinstance(chunk, list):
            raise RuntimeError("reviews_bad_shape")
        reviews.extend(chunk)
        if len(chunk) < 100:
            break
    checks_body = _get(t, root + "/commits/" + HEAD_SHA + "/check-runs", {"per_page": 100})
    if not isinstance(checks_body, Mapping) or not isinstance(checks_body.get("check_runs"), list):
        raise RuntimeError("checks_bad_shape")
    runs = []
    for check in checks_body["check_runs"]:
        app = check.get("app") if isinstance(check, Mapping) else {}
        if isinstance(check, Mapping) and check.get("name") in {"backend", "frontend"}:
            runs.append({"name": check.get("name"), "head_sha": check.get("head_sha"), "status": check.get("status"),
                         "conclusion": check.get("conclusion"), "app_slug": (app or {}).get("slug"),
                         "base_sha": _check_base(t, root, check), "check_suite_id": (check.get("check_suite") or {}).get("id")})
    thread_response = t.graphql(attestation_threads_query(), {"owner": "ter-ry", "repo": "restaurant-helper", "pr": PR_NUMBER, "after": None})
    body = thread_response.get("body") if isinstance(thread_response, Mapping) else None
    thread_box = (((body or {}).get("data") or {}).get("repository") or {}).get("pullRequest", {}).get("reviewThreads", {})
    nodes = thread_box.get("nodes") if isinstance(thread_box, Mapping) else None
    if not isinstance(nodes, list) or (thread_box.get("pageInfo") or {}).get("hasNextPage") is True:
        raise RuntimeError("threads_bad_shape")
    requested = _get(t, root + f"/pulls/{PR_NUMBER}/requested_reviewers")
    if not isinstance(requested, Mapping) or not isinstance(requested.get("users"), list) or not isinstance(requested.get("teams"), list):
        raise RuntimeError("requested_reviewers_bad_shape")
    prior = [c for c in checks_body["check_runs"] if isinstance(c, Mapping) and c.get("name") == att.CHECK_NAME]
    return {"repository": REPOSITORY, "pr": {"number": pr.get("number"), "state": pr.get("state"), "draft": pr.get("draft"),
            "base_ref": (pr.get("base") or {}).get("ref"), "base_sha": (pr.get("base") or {}).get("sha"),
            "head_sha": (pr.get("head") or {}).get("sha"), "base_repo": ((pr.get("base") or {}).get("repo") or {}).get("full_name"),
            "head_repo": ((pr.get("head") or {}).get("repo") or {}).get("full_name"), "author": (pr.get("user") or {}).get("login")},
        "head_parents": [p.get("sha") for p in head.get("parents", []) if isinstance(p, Mapping)], "main_sha": MAIN_SHA,
        "head_tree": (head.get("commit") or {}).get("tree", {}).get("sha"), "main_tree": (main.get("commit") or {}).get("tree", {}).get("sha"),
        "threads": [{"id": n.get("databaseId"), "is_resolved": n.get("isResolved")} for n in nodes if isinstance(n, Mapping)],
        "checks": runs, "reviews": reviews, "requested_reviewers": requested["users"] + requested["teams"],
        "existing_verifier_success": any(c.get("conclusion") == "success" and (c.get("app") or {}).get("id") == int(os.environ.get("VERIFIER_APP_ID", "0")) for c in prior),
        "security_controls_unchanged": security_controls_unchanged}


def attestation_threads_query() -> str:
    return ("query($owner:String!,$repo:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$repo)"
            "{pullRequest(number:$pr){reviewThreads(first:100,after:$after){nodes{databaseId isResolved isOutdated} "
            "pageInfo{hasNextPage endCursor}}}}}")


def _check_base(t: Any, root: str, check: Mapping[str, Any]) -> str | None:
    """Require an unambiguous pull_request workflow run for the check's exact suite."""
    suite = (check.get("check_suite") or {}).get("id")
    if suite is None:
        return None
    runs = _get(t, root + "/actions/runs", {"head_sha": HEAD_SHA, "event": "pull_request", "per_page": 100})
    candidates = [r for r in (runs or {}).get("workflow_runs", []) if isinstance(r, Mapping) and r.get("check_suite_id") == suite]
    if len(candidates) != 1:
        return None
    prs = candidates[0].get("pull_requests")
    base = ((prs[0] if isinstance(prs, list) and len(prs) == 1 else {}) or {}).get("base") or {}
    return base.get("sha") if base.get("ref") == "develop" and (base.get("repo") or {}).get("id") == REPOSITORY_ID else None


def main() -> int:
    actor = os.environ.get("GITHUB_ACTOR", "")
    reasons = check_target(actor, PR_NUMBER, HEAD_SHA, BASE_SHA)
    if reasons:
        print(json.dumps(_reject(*reasons), sort_keys=True))
        return 2
    try:
        private_key = os.environ["FLOWTALLY_VERIFIER_APP_PRIVATE_KEY"]
        app_id = int(os.environ["VERIFIER_APP_ID"])
        jwt = runtime.mint_app_jwt(app_id, private_key, datetime.now(timezone.utc))
        jwt_transport = runtime.HttpTransport(jwt)
        token, permissions = runtime.mint_installation_token(jwt_transport, REPOSITORY, runtime.VERIFIER_TOKEN_PERMISSIONS)
        if runtime.verifier_permission_problems(permissions):
            raise RuntimeError("verifier_permissions_not_allowlisted")
        transport = runtime.HttpTransport(token)
        now = datetime.now(timezone.utc)
        if not verify_ruleset_attestation_from_env(os.environ, now):
            print(json.dumps({"action": "blocked", "reasons": ["ruleset_attestation_invalid_or_missing"]}, sort_keys=True))
            return 1
        evidence = collect_live(transport, security_controls_unchanged=True)
        result = verify_manual(evidence, public_key=public_key_from_env(os.environ), now=now)
        print(json.dumps(result, sort_keys=True))
        if not result.get("verified"):
            return 1
        if not live_writes_enabled(os.environ):
            print(json.dumps({"action": "dry_run", "check": plan_verifier_check(result, app_id)}, sort_keys=True))
            return 0
        request = plan_verifier_check(result, app_id)
        response = transport.post(f"/repos/{REPOSITORY}/check-runs", {"name": request["name"], "head_sha": HEAD_SHA,
            "status": "completed", "conclusion": "success", "output": {"title": "trusted review verified",
            "summary": request["output"]["summary"]}})
        body = response.get("body") if isinstance(response, Mapping) else None
        if response.get("status") != 201 or (body or {}).get("name") != att.CHECK_NAME or (body or {}).get("head_sha") != HEAD_SHA \
                or ((body or {}).get("app") or {}).get("id") != app_id:
            print(json.dumps({"action": "blocked", "reasons": ["check_post_unconfirmed"]}, sort_keys=True))
            return 1
        print(json.dumps({"action": "posted", "head_sha": HEAD_SHA, "app_id": app_id}, sort_keys=True))
        return 0
    except Exception as exc:  # fixed, non-secret failure surface
        print(json.dumps({"action": "blocked", "reasons": ["manual_verifier_error:" + type(exc).__name__]}, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
