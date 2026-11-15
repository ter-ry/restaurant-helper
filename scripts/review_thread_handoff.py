#!/usr/bin/env python3
"""Read-only review-thread handoff classifier (#305).

Classifies a PR's unresolved review threads at its exact head SHA and produces
at most one deduplicated handoff message. It never resolves threads, approves,
merges or posts anything: posting is done by the calling agent with its own
GitHub tools. Unknown or inconsistent input fails closed (state BLOCKED_UNVERIFIED).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SHA_RE = r"[0-9a-f]{40}"
VERDICT = re.compile(rf"\b(APPROVE|REQUEST CHANGES|BLOCKED)\s*@\s*({SHA_RE})\b", re.I)
FIXED = re.compile(rf"\bFixed\s*@\s*({SHA_RE})\b", re.I)
MARKER = re.compile(r"<!--\s*thread-handoff:([0-9a-f]{16})\s*-->")
REQUIRED_CHECKS = frozenset({"backend", "frontend"})

# States, in order of precedence.
BLOCKED_UNVERIFIED = "BLOCKED_UNVERIFIED"
FINDING_OPEN = "FINDING_OPEN"
FIX_PENDING_VERIFICATION = "FIX_PENDING_VERIFICATION"
APPROVAL_STALE = "APPROVAL_STALE"
CI_NOT_GREEN = "CI_NOT_GREEN"
THREADS_RESOLVED_AWAITING_REVIEW = "THREADS_RESOLVED_AWAITING_REVIEW"
OWNER_MERGE_PENDING = "OWNER_MERGE_PENDING"


def _is_sha(value) -> bool:
    return isinstance(value, str) and re.fullmatch(SHA_RE, value) is not None


def _verdicts(comments, head, author):
    """Return (verdicts at head, verdicts at other SHAs) from non-author comments."""
    at_head, other = [], []
    for c in comments:
        login = (c.get("user") or {}).get("login", "").lower()
        if login == author:
            continue  # an agent never approves its own PR
        for kind, sha in VERDICT.findall(c.get("body") or ""):
            (at_head if sha.lower() == head else other).append(kind.upper())
    return at_head, other


def classify(snapshot: dict) -> dict:
    """Pure function. snapshot keys: pr{number,state,user,head_sha}, threads,
    threads_verified, checks, comments, viewer_can_resolve (optional)."""
    pr = snapshot.get("pr") or {}
    head = str(pr.get("head_sha", "")).lower()
    author = str((pr.get("user") or {}).get("login", "")).lower()
    reasons: list[str] = []

    if not _is_sha(head) or pr.get("state") != "open":
        return _result(pr, BLOCKED_UNVERIFIED, ["PR_NOT_OPEN_OR_HEAD_UNKNOWN"], [])
    if snapshot.get("threads_verified") is not True or not isinstance(snapshot.get("threads"), list):
        return _result(pr, BLOCKED_UNVERIFIED, ["THREADS_UNVERIFIED"], [])

    unresolved = [t for t in snapshot["threads"] if t.get("isResolved") is not True]
    for t in snapshot["threads"]:
        if not isinstance(t.get("isResolved"), bool):
            return _result(pr, BLOCKED_UNVERIFIED, ["THREAD_STATE_AMBIGUOUS:" + str(t.get("id"))], [])

    checks = {c["name"]: c for c in snapshot.get("checks", [])
              if c.get("head_sha") == head and c.get("name") in REQUIRED_CHECKS}
    ci_green = all(n in checks and checks[n].get("status") == "completed"
                   and checks[n].get("conclusion") == "success" for n in REQUIRED_CHECKS)
    approvals, other = _verdicts(snapshot.get("comments", []), head, author)
    rejected = any(v in ("REQUEST CHANGES", "BLOCKED") for v in approvals)
    approved = "APPROVE" in approvals and not rejected

    pending, open_ids = [], []
    for t in unresolved:
        fixed_shas = {m.lower() for c in t.get("comments", []) for m in FIXED.findall(c.get("body") or "")}
        (pending if head in fixed_shas else open_ids).append(t.get("id"))

    if open_ids:
        state = FINDING_OPEN
        reasons.append("UNRESOLVED_WITHOUT_FIX_AT_HEAD")
    elif pending:
        state = FIX_PENDING_VERIFICATION
        reasons.append("FIXED_AT_HEAD_AWAITING_REVIEWER_RESOLVE")
        if snapshot.get("viewer_can_resolve") is False:
            reasons.append("REVIEWER_CANNOT_RESOLVE_ESCALATE_TO_OWNER")
        if not ci_green:
            reasons.append("CI_NOT_GREEN_AT_HEAD")
    elif not ci_green:
        state = CI_NOT_GREEN
        reasons.append("CI_NOT_GREEN_AT_HEAD")
    elif not approved:
        state = APPROVAL_STALE if other else THREADS_RESOLVED_AWAITING_REVIEW
        reasons.append("NO_INDEPENDENT_APPROVE_AT_HEAD")
    else:
        state = OWNER_MERGE_PENDING
    return _result(pr, state, reasons, pending + open_ids)


def _result(pr, state, reasons, thread_ids):
    head = str(pr.get("head_sha", "")).lower()
    key = hashlib.sha256(
        "|".join([str(pr.get("number")), head, state, *sorted(map(str, thread_ids))]).encode()
    ).hexdigest()[:16]
    return {"pr": pr.get("number"), "head_sha": head, "state": state, "reasons": reasons,
            "threads": sorted(map(str, thread_ids)), "dedup_key": key,
            "mark_owner_merge_ready": state == OWNER_MERGE_PENDING}


def handoff_message(result: dict, existing_comments) -> str | None:
    """One message per (PR, head, state, thread set); None if already sent or nothing to do."""
    if result["state"] in (OWNER_MERGE_PENDING, THREADS_RESOLVED_AWAITING_REVIEW):
        return None
    seen = {m for c in existing_comments for m in MARKER.findall(c.get("body") or "")}
    if result["dedup_key"] in seen:
        return None
    return (f"<!-- thread-handoff:{result['dedup_key']} -->\n"
            f"REVIEW-THREAD HANDOFF: PR #{result['pr']} @ {result['head_sha']}\n"
            f"State: {result['state']}\nThreads: {', '.join(result['threads']) or 'n/a'}\n"
            f"Reasons: {', '.join(result['reasons'])}\n"
            "Reviewer: verify the fix and resolve each listed thread, or REQUEST CHANGES @ this SHA. "
            "Nothing here is approval or merge authorization.")


QUERY = """query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){
state headRefOid author{login} reviewThreads(first:100){pageInfo{hasNextPage}nodes{id isResolved viewerCanResolve
comments(first:50){nodes{body author{login}}}}}}}}"""


def fetch_threads(owner, repo, number, token):
    """GraphQL read. Any failure or pagination overflow returns verified=False."""
    body = json.dumps({"query": QUERY, "variables": {"o": owner, "r": repo, "n": number}}).encode()
    req = Request("https://api.github.com/graphql", body,
                  {"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=20) as resp:
            pr = json.load(resp)["data"]["repository"]["pullRequest"]
        rt = pr["reviewThreads"]
        if rt["pageInfo"]["hasNextPage"]:
            return {"threads_verified": False}
        threads = [{"id": n["id"], "isResolved": n["isResolved"],
                    "comments": [{"body": c["body"]} for c in n["comments"]["nodes"]]}
                   for n in rt["nodes"]]
        return {"threads_verified": True, "threads": threads,
                "viewer_can_resolve": all(n["viewerCanResolve"] for n in rt["nodes"]) if rt["nodes"] else None,
                "head_sha": pr["headRefOid"]}
    except (HTTPError, URLError, KeyError, TypeError, ValueError, OSError):
        return {"threads_verified": False}


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--snapshot", help="JSON snapshot file (offline); otherwise GraphQL is queried for thread state only")
    p.add_argument("--repo", default="ter-ry/restaurant-helper")
    p.add_argument("--pr", type=int)
    args = p.parse_args(argv)
    if args.snapshot:
        with open(args.snapshot, encoding="utf-8") as fh:
            snap = json.load(fh)
    else:
        token = os.environ.get("GITHUB_TOKEN", "")
        if not token or not args.pr:
            print(json.dumps({"state": BLOCKED_UNVERIFIED, "reasons": ["NO_TOKEN_OR_PR; use --snapshot"]}))
            return 2
        owner, repo = args.repo.split("/", 1)
        snap = {"pr": {"number": args.pr, "state": "open", "user": {}, "head_sha": ""},
                **fetch_threads(owner, repo, args.pr, token), "checks": [], "comments": []}
        snap["pr"]["head_sha"] = snap.pop("head_sha", "")
    result = classify(snap)
    result["message"] = handoff_message(result, snap.get("comments", []))
    print(json.dumps(result, indent=2))
    return 0 if result["state"] != BLOCKED_UNVERIFIED else 2


if __name__ == "__main__":
    sys.exit(main())
