"""Pure, offline, fail-closed decision policy for the future develop gatekeeper.

This module evaluates a *supplied static evidence snapshot* and returns a
structured decision. It performs no I/O: no network, no GitHub API calls, no
tokens, no file or environment reads, no merging. A decision of
``ELIGIBLE_FOR_REVIEW`` means "candidate only"; it never authorizes a merge.
See docs/DEVELOP_MERGE_POLICY.md for the contract and the evidence that a
trusted actor must fetch itself.
"""
from __future__ import annotations

import posixpath
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

ELIGIBLE_FOR_REVIEW = "ELIGIBLE_FOR_REVIEW"
BLOCKED = "BLOCKED"
OWNER_DECISION = "OWNER_DECISION"
UNVERIFIED = "UNVERIFIED"

REQUIRED_CHECKS = ("backend", "frontend")
TRUSTED_CHECK_APP = "github-actions"
ALLOWED_REPOSITORY = "ter-ry/restaurant-helper"
ALLOWED_BASE = "develop"
QUALIFYING_REVIEW_KIND = "independent_substantive"
DANGEROUS_FLAGS = frozenset({"CLOVER_ORDER_INVENTORY_ENABLED", "FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED"})
_SHA = re.compile(r"^[0-9a-f]{40}$")

# Tier 2: never unattended, regardless of labels.
_TIER2_PREFIXES = (
    ".github/", "migrations/", "backend/migrations/", "backend/alembic/", "infra/",
    "scripts/develop_merge_policy", "backend/tests/test_develop_merge_policy",
    "docs/develop_merge_policy", "docs/autonomous_integration_runbook",
)
_TIER2_EXACT = frozenset({
    "agents.md", "claude.md", "procfile", "render.yaml", "render.pilot-staging.yaml",
    "backend/.env.staging.example", "backend/auth.py", "backend/security.py",
})
_TIER2_PATTERNS = (
    re.compile(r"(^|/)\.env"), re.compile(r"(^|/)render[^/]*\.ya?ml$"),
    re.compile(r"(^|/)(secrets?|credentials?)[^/]*"), re.compile(r"(^|/)deploy[^/]*"),
    re.compile(r"(^|/)(auth|oauth|session)[^/]*\.py$"), re.compile(r"alembic"),
    re.compile(r"(^|/)(gatekeeper|release)[^/]*"),
)
# Tier 1: financial / inventory / POS / reporting / backend / RLS: owner-controlled.
_TIER1_PREFIXES = ("backend/", "scripts/")
# Tier 0 candidates: docs and frontend-only paths that are not otherwise classified.
_TIER0_PREFIXES = ("docs/", "src/", "tests/frontend/", "public/")


@dataclass(frozen=True)
class Decision:
    decision: str
    reasons: tuple[str, ...] = field(default_factory=tuple)
    tier: str = "unknown"
    # Always False: this policy can never authorize a live merge by itself.
    merge_authorized: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision, "reasons": list(self.reasons),
            "tier": self.tier, "merge_authorized": self.merge_authorized,
        }


def _is_sha(v: Any) -> bool:
    return isinstance(v, str) and bool(_SHA.match(v))


def _is_bool(v: Any) -> bool:
    return isinstance(v, bool)


def normalize_path(path: Any) -> str | None:
    """Return a canonical lowercase repo-relative path, or None if suspicious."""
    if not isinstance(path, str) or not path or "\x00" in path or "\\" in path:
        return None
    if path.startswith("/") or any(p in ("..", ".") for p in path.split("/")):
        return None
    norm = posixpath.normpath(path)
    return norm.lower() if norm == path else None


def classify_path(path: Any) -> str | None:
    """'tier2' | 'tier1' | 'tier0' | 'unclassified'; None for invalid paths."""
    p = normalize_path(path)
    if p is None:
        return None
    if p in _TIER2_EXACT or p.startswith(_TIER2_PREFIXES) or any(r.search(p) for r in _TIER2_PATTERNS):
        return "tier2"
    if p.startswith(_TIER1_PREFIXES):
        return "tier1"
    if p.startswith(_TIER0_PREFIXES):
        return "tier0"
    return "unclassified"




def _get(snapshot: Mapping[str, Any], key: str, unverified: list[str], code: str) -> str | None:
    v = snapshot.get(key)
    if not isinstance(v, str) or not v:
        unverified.append(code)
        return None
    return v


def evaluate(snapshot: Any, trusted_reviewers: Iterable[str] = ()) -> Decision:
    """Evaluate a static snapshot. Every unknown or malformed input fails closed.

    ``trusted_reviewers`` is supplied by the trusted caller (never read from the
    snapshot or PR text); empty means no review can qualify.
    """
    blocked: list[str] = []
    unverified: list[str] = []
    owner: list[str] = []

    if not isinstance(snapshot, Mapping):
        return Decision(UNVERIFIED, ("SNAPSHOT_INVALID",))
    try:
        trusted = {t.lower() for t in trusted_reviewers if isinstance(t, str) and t}
    except TypeError:
        trusted = set()

    errs = snapshot.get("api_errors")
    if errs is None or not isinstance(errs, (list, tuple)):
        unverified.append("API_ERRORS_FIELD_MISSING")
    elif errs:
        unverified.append("API_ERROR_REPORTED")

    repo = _get(snapshot, "repository", unverified, "REPOSITORY_MISSING")
    if repo is not None and repo != ALLOWED_REPOSITORY:
        blocked.append("WRONG_REPOSITORY")
    base = _get(snapshot, "base_ref", unverified, "BASE_REF_MISSING")
    if base is not None and base != ALLOWED_BASE:
        blocked.append("BASE_NOT_DEVELOP")
    author = _get(snapshot, "author", unverified, "AUTHOR_MISSING")

    head = snapshot.get("head_sha")
    if not _is_sha(head):
        unverified.append("HEAD_SHA_INVALID")
    elif snapshot.get("expected_head_sha") != head:
        blocked.append("HEAD_MOVED")
    base_sha = snapshot.get("base_sha")
    if not _is_sha(base_sha):
        unverified.append("BASE_SHA_INVALID")
    elif snapshot.get("current_base_sha") != base_sha:
        blocked.append("BASE_CHANGED")

    for key, code_missing, code_block, bad_when in (
        ("draft", "DRAFT_MISSING", "DRAFT", True),
        ("mergeable", "MERGEABLE_MISSING", "MERGE_CONFLICT", False),
    ):
        v = snapshot.get(key)
        if not _is_bool(v):
            unverified.append(code_missing)
        elif v is bad_when:
            blocked.append(code_block)

    _check_checks(snapshot, head, base_sha, blocked, unverified)
    _check_threads(snapshot, blocked, unverified)
    _check_reviews(snapshot, head, author, trusted, blocked, unverified)
    _check_issue(snapshot, blocked, unverified, owner)
    tier = _check_files(snapshot, blocked, unverified, owner)

    flags = snapshot.get("flags_changed")
    if not isinstance(flags, (list, tuple)) or not all(isinstance(f, str) for f in flags):
        unverified.append("FLAGS_FIELD_INVALID")
    elif any(f.upper() in DANGEROUS_FLAGS for f in flags):
        blocked.append("DANGEROUS_FLAG_CHANGE")

    if blocked:
        return Decision(BLOCKED, _uniq(blocked + unverified + owner), tier)
    if unverified:
        return Decision(UNVERIFIED, _uniq(unverified + owner), tier)
    if owner:
        return Decision(OWNER_DECISION, _uniq(owner), tier)
    return Decision(ELIGIBLE_FOR_REVIEW, ("ALL_GATES_PASSED_CANDIDATE_ONLY",), tier)


def _uniq(items: list[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(items))


def _check_checks(s, head, base_sha, blocked, unverified):
    checks = s.get("checks")
    if not isinstance(checks, (list, tuple)):
        unverified.append("CHECKS_MISSING")
        return
    by_name: dict[str, list[Mapping]] = {}
    for c in checks:
        if not isinstance(c, Mapping) or not isinstance(c.get("name"), str):
            unverified.append("CHECK_MALFORMED")
            continue
        by_name.setdefault(c["name"], []).append(c)
    for name in REQUIRED_CHECKS:
        runs = by_name.get(name, [])
        if not runs:
            blocked.append(f"CHECK_MISSING_{name.upper()}")
        elif len(runs) > 1:
            unverified.append(f"CHECK_DUPLICATE_{name.upper()}")
        else:
            c = runs[0]
            if c.get("app_slug") != TRUSTED_CHECK_APP:
                blocked.append(f"CHECK_WRONG_SOURCE_{name.upper()}")
            elif _is_sha(head) and c.get("head_sha") != head:
                blocked.append(f"CHECK_STALE_{name.upper()}")
            elif _is_sha(base_sha) and c.get("base_sha") != base_sha:
                blocked.append(f"CHECK_STALE_BASE_{name.upper()}")
            elif c.get("status") != "completed":
                blocked.append(f"CHECK_PENDING_{name.upper()}")
            elif c.get("conclusion") != "success":
                blocked.append(f"CHECK_NOT_SUCCESS_{name.upper()}")


def _check_threads(s, blocked, unverified):
    threads = s.get("threads")
    if not isinstance(threads, (list, tuple)):
        unverified.append("THREADS_MISSING")
        return
    for t in threads:
        if not isinstance(t, Mapping) or not _is_bool(t.get("resolved")):
            unverified.append("THREAD_MALFORMED")
        elif not t["resolved"]:  # outdated unresolved threads still block
            blocked.append("UNRESOLVED_THREAD")


def _check_reviews(s, head, author, trusted, blocked, unverified):
    pending = s.get("pending_reviewers")
    if not isinstance(pending, (list, tuple)):
        unverified.append("PENDING_REVIEWERS_MISSING")
    elif pending:
        blocked.append("REVIEW_PENDING")
    reviews = s.get("reviews")
    if not isinstance(reviews, (list, tuple)):
        unverified.append("REVIEWS_MISSING")
        return
    qualifying = False
    for r in reviews:
        if not isinstance(r, Mapping):
            unverified.append("REVIEW_MALFORMED")
            continue
        login = r.get("reviewer")
        if not isinstance(login, str) or not login:
            unverified.append("REVIEW_MALFORMED")
            continue
        # Same-account / author / generic-bot / non-trusted reviews never qualify.
        if r.get("state") != "APPROVED" or r.get("kind") != QUALIFYING_REVIEW_KIND:
            continue
        if isinstance(author, str) and login.lower() == author.lower():
            blocked.append("REVIEW_SELF_AUTHORED")
        elif login.lower() not in trusted or r.get("identity_verified") is not True:
            blocked.append("REVIEW_IDENTITY_UNTRUSTED")
        elif not _is_sha(head) or r.get("commit_sha") != head:
            blocked.append("REVIEW_STALE")
        elif r.get("same_account_as_author") is not False:
            blocked.append("REVIEW_SAME_ACCOUNT")
        else:
            qualifying = True
    if not qualifying:
        blocked.append("REVIEW_MISSING")


def _check_issue(s, blocked, unverified, owner):
    issue = s.get("issue")
    if not isinstance(issue, Mapping):
        blocked.append("ISSUE_EVIDENCE_MISSING")
        return
    labels = issue.get("labels")
    if not isinstance(labels, (list, tuple)) or not all(isinstance(x, str) for x in labels):
        unverified.append("ISSUE_LABELS_INVALID")
        return
    ls = set(labels)
    if "needs-owner" in ls:
        blocked.append("ISSUE_NEEDS_OWNER")
    if "status:blocked" in ls:
        blocked.append("ISSUE_BLOCKED")
    if "status:in-progress" in ls and "status:review-ready" not in ls:
        blocked.append("ISSUE_STATE_CONTRADICTORY")
    if "status:ready" in ls and "status:review-ready" in ls:
        blocked.append("ISSUE_STATE_CONTRADICTORY")
    if not ls & {"status:review-ready", "status:in-progress"}:
        blocked.append("ISSUE_NOT_CLAIMED")
    if "unattended-ok" not in ls:
        blocked.append("ISSUE_NOT_UNATTENDED_OK")
    for key, code in (("dependencies_closed", "DEPENDENCIES_UNMET"),
                      ("file_claim_overlap", "FILE_CLAIM_OVERLAP")):
        v = issue.get(key)
        if not _is_bool(v):
            unverified.append(code + "_UNVERIFIED")
        elif (key == "dependencies_closed") != v:
            blocked.append(code)
    if issue.get("linked") is not True:
        blocked.append("ISSUE_NOT_LINKED")


def _check_files(s, blocked, unverified, owner) -> str:
    files = s.get("changed_files")
    if not isinstance(files, (list, tuple)) or not files:
        unverified.append("CHANGED_FILES_MISSING")
        return "unknown"
    classes = set()
    for f in files:
        c = classify_path(f)
        if c is None:
            unverified.append("CHANGED_FILE_PATH_INVALID")
        else:
            classes.add(c)
    if "tier2" in classes:
        blocked.append("TIER2_PATH_CHANGED")
        return "tier2"
    if "tier1" in classes:
        owner.append("TIER1_OWNER_CONTROLLED")
        return "tier1"
    if "unclassified" in classes:
        owner.append("UNCLASSIFIED_PATH_OWNER_CONTROLLED")
        return "unclassified"
    return "tier0" if classes else "unknown"
