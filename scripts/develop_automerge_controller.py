"""Fail-closed develop-only merge actuator (issue #270). DISABLED BY DEFAULT.

Plans and (only when explicitly armed) performs a squash merge of a PR into ``develop``.
It combines, without relaxing any of them:

* ``develop_merge_policy.evaluate`` (risk tiers, checks, threads, labels),
* the read-only evidence collector (#284) incl. the live trusted-review kill switch,
* the trusted verifier check (#280/#286): ``trusted-review-verified`` made by the pinned verifier App,
  for this exact head, unexpired, plus a formal APPROVED review by the pinned reviewer bot (by numeric user id and login) at this head,
* live ``develop`` branch protection (strict checks, required review, conversation resolution,
  admins enforced, no force push/deletion).

Safety properties: nothing is armed unless ``FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED`` and the live
``FLOWTALLY_TRUSTED_REVIEW_ENABLED`` are both ``true``; no write happens unless
``FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES`` is also ``true`` (otherwise dry-run, and the write
transport method is never called); the only write is one ``PUT /pulls/{n}/merge`` pinned to the
evaluated head SHA, never to any base other than ``develop``, never ``main``; evidence is re-collected
and re-planned immediately before the write; at most one merge per run; no retry of a write.
Nothing here proves live GitHub behavior; activation is owner-controlled.
"""
from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Mapping

try:  # package-style and script-style imports both work
    from scripts import develop_merge_policy as policy
    from scripts import trusted_review_attestation as attest
    from scripts.trusted_review_evidence_collector import Collector
except ImportError:  # pragma: no cover
    import develop_merge_policy as policy  # type: ignore
    import trusted_review_attestation as attest  # type: ignore
    from trusted_review_evidence_collector import Collector  # type: ignore

ENABLE_VARIABLE = "FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED"
LIVE_WRITES_VARIABLE = "FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES"
KILL_SWITCH_VARIABLE = attest.KILL_SWITCH_VARIABLE
ALLOWED_BASE = policy.ALLOWED_BASE  # "develop"
VERIFIER_CHECK = attest.CHECK_NAME
REQUIRED_CONTEXTS = frozenset(policy.REQUIRED_CHECKS) | {VERIFIER_CHECK}
MERGE_METHOD = "squash"
_ISSUE_REF = re.compile(r"(?im)^\s*(?:closes|fixes|resolves)\s+#(\d+)\s*$")
_DEP_LINE = re.compile(r"(?im)^\s*(?:depends on|blocked by)\s*:\s*(.+)$")


@dataclass(frozen=True)
class Config:
    repository: str
    repo_id: int
    reviewer_bot_user_id: int  # numeric *user* id of the reviewer bot (REVIEWER_BOT_USER_ID), not the App id
    reviewer_login: str
    verifier_app_id: int
    enabled: bool = False
    live_writes: bool = False
    trusted_coauthor_emails: tuple[str, ...] = ()


@dataclass(frozen=True)
class Plan:
    action: str  # "MERGE" | "NONE"
    pr: int | None
    head_sha: str | None
    base_sha: str | None
    reasons: tuple[str, ...]

    infra_errors: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {"action": self.action, "pr": self.pr, "head_sha": self.head_sha,
                "base_sha": self.base_sha, "reasons": list(self.reasons)}


def _none(pr: Any, *reasons: str, head: str | None = None, base: str | None = None) -> Plan:
    return Plan("NONE", pr if isinstance(pr, int) else None, head, base, tuple(dict.fromkeys(reasons)) or ("UNKNOWN",))


class _ReadOnly:
    """Hands the collector only the read methods; it cannot reach the write method."""

    def __init__(self, t: Any):
        self._t = t

    def get(self, path: str, params: dict) -> Any:
        return self._t.get(path, params)

    def graphql(self, query: str, variables: dict) -> Any:
        return self._t.graphql(query, variables)


# ---------------------------------------------------------------- branch protection
def protection_problems(p: Any) -> list[str]:
    """Reasons the live `develop` branch protection is NOT strong enough to rely on. Empty = acceptable."""
    if not isinstance(p, Mapping):
        return ["PROTECTION_UNAVAILABLE"]
    out: list[str] = []

    def flag(key: str) -> Any:
        v = p.get(key)
        return v.get("enabled") if isinstance(v, Mapping) else None

    rsc = p.get("required_status_checks")
    if not isinstance(rsc, Mapping):
        out.append("PROTECTION_NO_REQUIRED_CHECKS")
    else:
        if rsc.get("strict") is not True:
            out.append("PROTECTION_NOT_STRICT")
        names: set[str] = set()
        for c in rsc.get("contexts") or []:
            if isinstance(c, str):
                names.add(c)
        for c in rsc.get("checks") or []:
            if isinstance(c, Mapping) and isinstance(c.get("context"), str):
                names.add(c["context"])
        if not REQUIRED_CONTEXTS <= names:
            out.append("PROTECTION_MISSING_REQUIRED_CONTEXTS")
    rpr = p.get("required_pull_request_reviews")
    if not isinstance(rpr, Mapping):
        out.append("PROTECTION_NO_REQUIRED_REVIEW")
    else:
        count = rpr.get("required_approving_review_count")
        if isinstance(count, bool) or not isinstance(count, int) or count < 1:
            out.append("PROTECTION_REVIEW_COUNT_TOO_LOW")
        if rpr.get("dismiss_stale_reviews") is not True:
            out.append("PROTECTION_STALE_REVIEWS_NOT_DISMISSED")
        allow = rpr.get("bypass_pull_request_allowances")
        if isinstance(allow, Mapping) and any(allow.get(k) for k in ("users", "teams", "apps")):
            out.append("PROTECTION_REVIEW_BYPASS_ALLOWED")
    if flag("enforce_admins") is not True:
        out.append("PROTECTION_ADMINS_NOT_ENFORCED")
    if flag("required_conversation_resolution") is not True:
        out.append("PROTECTION_CONVERSATIONS_NOT_REQUIRED")
    if flag("allow_force_pushes") is not False:
        out.append("PROTECTION_FORCE_PUSH_ALLOWED")
    if flag("allow_deletions") is not False:
        out.append("PROTECTION_DELETION_ALLOWED")
    return out


# ---------------------------------------------------------------- planning (pure)
def build_snapshot(evidence: Mapping[str, Any], extras: Mapping[str, Any], cfg: Config) -> dict[str, Any]:
    """Map collector evidence + controller-fetched extras onto the develop_merge_policy snapshot."""
    pr = evidence.get("pr") or {}
    author = (pr.get("user") or {}).get("login")
    head = (pr.get("head") or {}).get("sha")
    verifier_ok = bool(extras.get("verifier_ok"))
    reviews = []
    for r in evidence.get("reviews") or []:
        u = r.get("user") or {}
        pinned = u.get("id") == cfg.reviewer_bot_user_id and u.get("type") == "Bot" and u.get("login") == cfg.reviewer_login
        reviews.append({
            "reviewer": u.get("login") or "", "state": r.get("state"),
            "kind": policy.QUALIFYING_REVIEW_KIND if pinned else "other",
            "commit_sha": r.get("commit_id"),
            "identity_verified": bool(pinned and verifier_ok),
            "same_account_as_author": isinstance(author, str) and (u.get("login") or "").lower() == author.lower(),
        })
    errors = list(evidence.get("api_errors") or []) + list(extras.get("errors") or [])
    if evidence.get("incomplete"):
        errors.append("EVIDENCE_INCOMPLETE")
    return {
        "repository": evidence.get("repository"), "base_ref": (pr.get("base") or {}).get("ref"), "author": author,
        "head_sha": head, "expected_head_sha": head,
        "base_sha": (pr.get("base") or {}).get("sha"), "current_base_sha": extras.get("current_base_sha"),
        "draft": pr.get("draft"), "mergeable": extras.get("mergeable"),
        "api_errors": errors,
        # Only docs-only (tier 0) PRs can ever be eligible and those cannot change flags.
        "flags_changed": [],
        "changed_files": evidence.get("changed_files"),
        "checks": [{"name": c.get("name"), "head_sha": c.get("head_sha"), "base_sha": c.get("base_sha"),
                    "status": c.get("status"), "conclusion": c.get("conclusion"),
                    "app_slug": (c.get("app") or {}).get("slug")} for c in evidence.get("check_runs") or []],
        "threads": [{"resolved": t.get("is_resolved")} for t in evidence.get("threads") or []],
        "pending_reviewers": evidence.get("requested_reviewers"),
        "reviews": reviews, "issue": extras.get("issue"),
    }


def plan(evidence: Any, extras: Any, cfg: Config, now: datetime) -> Plan:
    """Decide whether a merge may be attempted. Any doubt returns NONE."""
    try:
        return _plan(evidence, extras, cfg, now)
    except Exception:  # noqa: BLE001 - deliberate fail-closed catch-all
        return _none(None, "PLANNER_INTERNAL_ERROR")


def _plan(evidence: Any, extras: Any, cfg: Config, now: datetime) -> Plan:
    if not isinstance(evidence, Mapping) or not isinstance(extras, Mapping):
        return _none(None, "EVIDENCE_INVALID")
    pr = evidence.get("pr") if isinstance(evidence.get("pr"), Mapping) else {}
    number = pr.get("number")
    head = (pr.get("head") or {}).get("sha")
    base = (pr.get("base") or {}).get("sha")
    if cfg.enabled is not True:
        return _none(number, "AUTO_MERGE_DISABLED", head=head, base=base)
    if (evidence.get("variables") or {}).get(KILL_SWITCH_VARIABLE) != "true":
        return _none(number, "TRUSTED_REVIEW_DISABLED", head=head, base=base)
    reasons: list[str] = []
    if evidence.get("repository") != cfg.repository or cfg.repository != policy.ALLOWED_REPOSITORY:
        reasons.append("WRONG_REPOSITORY")
    if (pr.get("base") or {}).get("ref") != ALLOWED_BASE:
        reasons.append("BASE_NOT_DEVELOP")
    if pr.get("state") != "open":
        reasons.append("PR_NOT_OPEN")
    if ((pr.get("head") or {}).get("repo") or {}).get("id") != cfg.repo_id:
        reasons.append("FORK_HEAD")  # a head outside the base repo (or unknown) is never auto-merged
    fresh = extras.get("fresh_pr")
    if not isinstance(fresh, Mapping) or (fresh.get("base_ref"), fresh.get("base_sha"), fresh.get("head_sha"), fresh.get("state")) \
            != (ALLOWED_BASE, base, head, "open"):
        reasons.append("LIVE_PR_IDENTITY_MISMATCH")  # retargeted, moved or closed since collection
    reasons += protection_problems(extras.get("protection"))
    if attest.verify_check_source(extras.get("verifier_check"), head or "", cfg.verifier_app_id, now):
        reasons.append("VERIFIER_PROOF_MISSING_OR_INVALID")
    snap_extras = {**extras, "verifier_ok": "VERIFIER_PROOF_MISSING_OR_INVALID" not in reasons}
    decision = policy.evaluate(build_snapshot(evidence, snap_extras, cfg), trusted_reviewers=(cfg.reviewer_login,))
    if decision.decision != policy.ELIGIBLE_FOR_REVIEW:
        reasons.append(f"POLICY_{decision.decision}")
        reasons.extend(decision.reasons)
    elif decision.tier != "tier0":
        reasons.append("TIER_NOT_ZERO")
    approvals = [r for r in evidence.get("reviews") or []
                 if (r.get("user") or {}).get("id") == cfg.reviewer_bot_user_id and r.get("state") == "APPROVED"
                 and r.get("commit_id") == head]
    if not approvals:
        reasons.append("NO_FORMAL_APPROVAL_AT_HEAD")
    if reasons:
        return _none(number, *reasons, head=head, base=base)
    return Plan("MERGE", number, head, base, ("ALL_GATES_PASSED",))


# ---------------------------------------------------------------- I/O orchestration
def _body(resp: Any, what: str) -> Any:
    if not isinstance(resp, Mapping) or resp.get("status") != 200:
        raise RuntimeError(f"{what}:unavailable")
    return resp.get("body")


def gather_extras(t: Any, cfg: Config, evidence: Mapping[str, Any]) -> dict[str, Any]:
    """Read the controller-side evidence the collector does not provide. Failures become `errors`."""
    root = f"/repos/{cfg.repository}"
    pr = evidence.get("pr") or {}
    n, head = pr.get("number"), (pr.get("head") or {}).get("sha")
    extras: dict[str, Any] = {"errors": []}

    def safe(key: str, what: str, fn):
        try:
            extras[key] = fn()
        except Exception as exc:  # noqa: BLE001
            extras["errors"].append(f"{what}:{type(exc).__name__}:{exc}")

    def live_pr():
        b = _body(t.get("%s/pulls/%s" % (root, n), {}), "pr")
        extras["current_base_sha"] = None
        extras["fresh_pr"] = {"base_ref": (b.get("base") or {}).get("ref"), "base_sha": (b.get("base") or {}).get("sha"),
                              "head_sha": (b.get("head") or {}).get("sha"), "state": b.get("state")}
        br = _body(t.get(f"{root}/branches/{ALLOWED_BASE}", {}), "base_branch")
        extras["current_base_sha"] = (br.get("commit") or {}).get("sha")
        # mergeable_state "clean" = up to date with base, checks satisfied, no conflicts (strict mode).
        return True if (b.get("mergeable") is True and b.get("mergeable_state") == "clean") else (
            None if b.get("mergeable") is None else False)

    safe("mergeable", "mergeable", live_pr)
    safe("protection", "protection", lambda: _body(t.get(f"{root}/branches/{ALLOWED_BASE}/protection", {}), "protection"))

    def verifier():
        body = _body(t.get(f"{root}/commits/{head}/check-runs", {"check_name": VERIFIER_CHECK, "per_page": 100}), "verifier")
        runs = [r for r in body.get("check_runs", []) if r.get("name") == VERIFIER_CHECK]
        if len(runs) != 1:
            raise RuntimeError("verifier_check_count_%d" % len(runs))
        return runs[0]

    safe("verifier_check", "verifier", verifier)
    safe("issue", "issue", lambda: _issue_evidence(t, cfg, evidence))
    return extras


def _has_merged_implementation(t: Any, cfg: Config, issue_number: int) -> bool:
    """True only if a PR in this repository that references the issue is merged (timeline cross-reference)."""
    events = _body(t.get(f"/repos/{cfg.repository}/issues/{issue_number}/timeline", {"per_page": 100}), "timeline")
    if not isinstance(events, list) or len(events) >= 100:
        return False  # cannot see the whole timeline: fail closed
    for e in events:
        if not isinstance(e, Mapping) or e.get("event") != "cross-referenced":
            continue
        src = (e.get("source") or {}).get("issue") or {}
        pr = src.get("pull_request") or {}
        if pr.get("merged_at") and (src.get("repository") or {}).get("full_name") == cfg.repository:
            return True
    return False


def _issue_evidence(t: Any, cfg: Config, evidence: Mapping[str, Any]) -> dict[str, Any]:
    root = f"/repos/{cfg.repository}"
    n = (evidence.get("pr") or {}).get("number")
    pr = _body(t.get(f"{root}/pulls/{n}", {}), "pr")
    refs = set(_ISSUE_REF.findall(pr.get("body") or ""))
    if len(refs) != 1:
        return {"linked": False, "labels": [], "dependencies_closed": False, "file_claim_overlap": True}
    num = int(next(iter(refs)))
    issue = _body(t.get(f"{root}/issues/{num}", {}), "issue")
    if issue.get("pull_request") or issue.get("state") != "open":
        return {"linked": False, "labels": [], "dependencies_closed": False, "file_claim_overlap": True}
    labels = [lb.get("name") for lb in issue.get("labels", []) if isinstance(lb, Mapping)]
    deps_ok = True
    for line in _DEP_LINE.findall(issue.get("body") or ""):
        for d in re.findall(r"#(\d+)", line):
            dep = _body(t.get(f"{root}/issues/{d}", {}), "dependency")
            if dep.get("state") != "closed" or dep.get("state_reason") != "completed" \
                    or not _has_merged_implementation(t, cfg, int(d)):
                deps_ok = False  # closure alone is not completion: AGENTS.md also needs the merged PR
    overlap = False
    mine = set(evidence.get("changed_files") or [])
    others = _body(t.get(f"{root}/pulls", {"state": "open", "per_page": 100}), "open_prs")  # every base, not only develop
    if not isinstance(others, list) or len(others) >= 100:
        overlap = True  # cannot enumerate every competing PR: fail closed
    else:
        for o in others:
            if o.get("number") == n:
                continue
            files = _body(t.get(f"{root}/pulls/{o.get('number')}/files", {"per_page": 100}), "other_pr_files")
            theirs = {f.get("filename") for f in files} | {f.get("previous_filename") for f in files}
            if len(files) >= 100 or mine & theirs:
                overlap = True
    return {"linked": True, "labels": labels, "dependencies_closed": deps_ok, "file_claim_overlap": overlap}


@dataclass
class RunReport:
    plans: list[dict[str, Any]] = field(default_factory=list)
    merged: dict[str, Any] | None = None
    live_writes: bool = False
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"plans": self.plans, "merged": self.merged, "live_writes": self.live_writes, "errors": self.errors}


def _evaluate(t: Any, cfg: Config, number: int, now: datetime) -> Plan:
    col = Collector(_ReadOnly(t), repository=cfg.repository, repo_id=cfg.repo_id, allowed_bases=(ALLOWED_BASE,),
                    trusted_coauthor_emails=cfg.trusted_coauthor_emails)
    evidence = col.collect(number)
    extras = gather_extras(t, cfg, evidence)
    result = plan(evidence, extras, cfg, now)
    infra = _infra_errors(evidence, extras)
    return replace(result, infra_errors=infra) if infra else result


_INFRA_MARKERS = ("http_", "rate_limited", "transport_error", "unavailable", "truncated", "collector_error",
                  "malformed_response", "bad_shape", "count_mismatch", "graphql_error", "race:")


def _infra_errors(evidence: Mapping[str, Any], extras: Mapping[str, Any]) -> tuple[str, ...]:
    """API/permission/transport failures (not ordinary eligibility blockers) must turn the run red."""
    errs = [e for e in (evidence.get("api_errors") or []) if any(m in str(e) for m in _INFRA_MARKERS)]
    errs += list(extras.get("errors") or [])
    return tuple(dict.fromkeys(str(e) for e in errs))


def run_once(t: Any, cfg: Config, clock=lambda: datetime.now(timezone.utc)) -> RunReport:
    """Evaluate every open develop PR; merge at most one, only when armed and live, after a fresh re-plan."""
    rep = RunReport(live_writes=bool(cfg.enabled and cfg.live_writes))
    if cfg.enabled is not True:
        rep.errors.append("AUTO_MERGE_DISABLED")
        return rep
    try:
        listing = _body(t.get(f"/repos/{cfg.repository}/pulls", {"state": "open", "base": ALLOWED_BASE, "per_page": 100}), "list")
        if not isinstance(listing, list) or len(listing) >= 100:
            raise RuntimeError("list:incomplete")
    except Exception as exc:  # noqa: BLE001
        rep.errors.append(f"LIST_FAILED:{exc}")
        return rep
    for item in listing:
        n = item.get("number") if isinstance(item, Mapping) else None
        if isinstance(n, bool) or not isinstance(n, int):
            rep.errors.append("LIST_ITEM_INVALID")
            continue
        p = _evaluate(t, cfg, n, clock())
        rep.plans.append(p.as_dict())
        rep.errors.extend(f"INFRA_ERROR:{n}:{e}" for e in p.infra_errors)
        if p.action != "MERGE" or not rep.live_writes:
            continue
        # Fresh re-read immediately before the one write; any difference aborts.
        again = _evaluate(t, cfg, n, clock())
        if again.action != "MERGE" or (again.head_sha, again.base_sha) != (p.head_sha, p.base_sha):
            rep.errors.append(f"REPLAN_DIVERGED:{n}")
            continue
        rep.merged = _merge(t, cfg, p, rep)
        break  # base moved: never merge a second PR on this evidence
    return rep


def _merge(t: Any, cfg: Config, p: Plan, rep: RunReport) -> dict[str, Any]:
    root = f"/repos/{cfg.repository}"
    try:  # last identity check: retargeted/moved/closed PRs are never written to
        cur = _body(t.get(f"{root}/pulls/{p.pr}", {}), "pre_merge")
        ident = ((cur.get("base") or {}).get("ref"), (cur.get("base") or {}).get("sha"), (cur.get("head") or {}).get("sha"), cur.get("state"))
        if ident != (ALLOWED_BASE, p.base_sha, p.head_sha, "open"):
            rep.errors.append(f"PRE_MERGE_IDENTITY_MISMATCH:{p.pr}")
            return {"pr": p.pr, "head_sha": p.head_sha, "put_status": None, "merged_confirmed": False, "aborted": True}
    except Exception as exc:  # noqa: BLE001
        rep.errors.append(f"PRE_MERGE_READ_FAILED:{exc}")
        return {"pr": p.pr, "head_sha": p.head_sha, "put_status": None, "merged_confirmed": False, "aborted": True}
    try:
        resp = t.put(f"{root}/pulls/{p.pr}/merge", {"sha": p.head_sha, "merge_method": MERGE_METHOD})
    except Exception as exc:  # noqa: BLE001 - never retried: outcome is verified by re-reading instead
        resp = {"status": 0, "error": type(exc).__name__}
    result = {"pr": p.pr, "head_sha": p.head_sha, "put_status": resp.get("status") if isinstance(resp, Mapping) else None}
    try:  # reconcile with authoritative server state, regardless of what the PUT said
        pr = _body(t.get(f"{root}/pulls/{p.pr}", {}), "post_merge")
        result["merged_confirmed"] = bool(pr.get("merged") is True and pr.get("merge_commit_sha"))
        result["merge_commit_sha"] = pr.get("merge_commit_sha")
    except Exception as exc:  # noqa: BLE001
        result["merged_confirmed"] = False
        rep.errors.append(f"POST_MERGE_VERIFY_FAILED:{exc}")
    if not result["merged_confirmed"]:
        rep.errors.append(f"MERGE_NOT_CONFIRMED:{p.pr}")
    return result


# ---------------------------------------------------------------- CLI transport (stdlib only)
class UrllibTransport:
    def __init__(self, token: str, api: str = "https://api.github.com"):
        self._token, self._api = token, api

    def _req(self, method: str, path: str, params: dict | None, body: Any) -> dict[str, Any]:
        import urllib.error
        import urllib.parse
        import urllib.request
        url = self._api + path + ("?" + urllib.parse.urlencode(params) if params else "")
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self._token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "flowtally-develop-automerge"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 - fixed https host
                return {"status": r.status, "headers": dict(r.headers), "body": json.loads(r.read() or b"null")}
        except urllib.error.HTTPError as e:
            return {"status": e.code, "headers": dict(e.headers), "body": None}

    def get(self, path: str, params: dict) -> dict[str, Any]:
        return self._req("GET", path, params, None)

    def graphql(self, query: str, variables: dict) -> dict[str, Any]:
        return self._req("POST", "/graphql", None, {"query": query, "variables": variables})

    def put(self, path: str, body: Any) -> dict[str, Any]:
        return self._req("PUT", path, None, body)


def _int_env(name: str) -> int:
    return int(os.environ[name])


def main(argv: list[str] | None = None) -> int:
    """Exit 0 only for a clean run (including a clean no-op/dry-run); nonzero on any error."""
    env = os.environ
    if env.get(ENABLE_VARIABLE) != "true":
        print(json.dumps({"status": "disabled", "reason": f"{ENABLE_VARIABLE} is not 'true'"}))
        return 0
    try:
        cfg = Config(
            repository=env["GITHUB_REPOSITORY"], repo_id=_int_env("FLOWTALLY_REPO_ID"),
            reviewer_bot_user_id=_int_env("REVIEWER_BOT_USER_ID"), reviewer_login=env["REVIEWER_BOT_LOGIN"],
            verifier_app_id=_int_env("VERIFIER_APP_ID"), enabled=True,
            live_writes=env.get(LIVE_WRITES_VARIABLE) == "true",
            trusted_coauthor_emails=tuple(e for e in env.get("TRUSTED_COAUTHOR_EMAILS", "").split(",") if e))
        rep = run_once(UrllibTransport(env["GITHUB_TOKEN"]), cfg)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"status": "error", "error": type(exc).__name__}))
        return 1
    print(json.dumps(rep.as_dict(), sort_keys=True))
    return 1 if rep.errors else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
