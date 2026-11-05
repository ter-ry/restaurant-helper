#!/usr/bin/env python3
"""Read-only GitHub PR handoff preflight.

This is deliberately *not* a merge bot, issue claimer, or review dispatcher.
No mutating API requests, subprocesses, database bootstrap, or credentials are
written by this script. Agent orchestration must be enabled separately by owner.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

VERDICT = re.compile(r"\b(APPROVE|REQUEST CHANGES|BLOCKED)\s*@\s*([0-9a-f]{40})\b", re.I)
REQUIRED_CHECKS = frozenset({"backend", "frontend"})
HIGH_RISK_PREFIXES = (
    "backend/", ".github/workflows/", "scripts/provision_postgres",
    "render", "Procfile", "src/lib/dailyClose", "src/pilot/PilotDailyClose",
)
HIGH_RISK_EXACT = frozenset({"AGENTS.md", "CLAUDE.md"})


def is_high_risk(paths: list[str]) -> bool:
    return any(p in HIGH_RISK_EXACT or p.startswith(HIGH_RISK_PREFIXES) for p in paths)


def evaluate(snapshot: dict, trusted_reviewers: set[str]) -> dict:
    """Return advisory status and suggested handoff; never authorize an actual merge."""
    pr = snapshot["pr"]
    sha = pr["head"]["sha"]
    author = pr["user"]["login"].lower()
    trusted = {login.lower() for login in trusted_reviewers if login.strip()}
    reasons: list[str] = []

    if pr.get("state") != "open" or pr.get("draft") or pr.get("base", {}).get("ref") != "main":
        reasons.append("PR_NOT_OPEN_READY_ON_MAIN")
    if pr.get("head", {}).get("repo", {}).get("full_name") != snapshot.get("repository"):
        reasons.append("UNSUPPORTED_FORK_HEAD")
    if snapshot.get("open_review_threads") is not False:
        # GitHub REST does not expose unresolved-thread status reliably. Unknown != clear.
        reasons.append("REVIEW_THREADS_UNVERIFIED")

    checks = {}
    for check in snapshot.get("checks", []):
        if check.get("head_sha") == sha and check.get("name") in REQUIRED_CHECKS:
            checks[check["name"]] = check

    missing = sorted(REQUIRED_CHECKS - checks.keys())
    if missing:
        reasons.append("REQUIRED_CHECKS_MISSING:" + ",".join(missing))
    failed = sorted(
        name for name, c in checks.items()
        if c.get("status") == "completed" and c.get("conclusion") not in ("success",)
    )
    incomplete = sorted(name for name, c in checks.items() if c.get("status") != "completed")
    if failed:
        reasons.append("CI_FAILED:" + ",".join(failed))
    if incomplete:
        reasons.append("CI_PENDING:" + ",".join(incomplete))

    # Only a genuinely separate, explicitly trusted GitHub identity can review.
    # Same-account comments from another AI service cannot count as independent.
    verdicts: dict[str, tuple[str, str]] = {}
    for comment in snapshot.get("comments", []):
        login = comment.get("user", {}).get("login", "").lower()
        if login not in trusted or login == author:
            continue
        match = VERDICT.search(comment.get("body") or "")
        if match and match.group(2).lower() == sha.lower():
            timestamp = comment.get("created_at") or ""
            if login not in verdicts or timestamp >= verdicts[login][0]:
                verdicts[login] = (timestamp, match.group(1).upper())
    for review in snapshot.get("reviews", []):
        login = review.get("user", {}).get("login", "").lower()
        if login not in trusted or login == author or review.get("commit_id") != sha:
            continue
        state = review.get("state", "").upper()
        if state not in ("APPROVED", "CHANGES_REQUESTED"):
            continue
        label = "APPROVE" if state == "APPROVED" else "REQUEST CHANGES"
        timestamp = review.get("submitted_at") or ""
        if login not in verdicts or timestamp >= verdicts[login][0]:
            verdicts[login] = (timestamp, label)

    verdict_values = [v for _, v in verdicts.values()]
    if any(v in ("REQUEST CHANGES", "BLOCKED") for v in verdict_values):
        reasons.append("TRUSTED_CHANGES_REQUESTED")
    if "APPROVE" not in verdict_values:
        reasons.append("INDEPENDENT_REVIEW_MISSING")
    if is_high_risk(snapshot.get("changed_files", [])):
        reasons.append("HIGH_RISK_OWNER_GATE")
    if snapshot.get("canonical_claim_verified") is not True:
        reasons.append("CANONICAL_CLAIM_UNVERIFIED")
    if snapshot.get("dependencies_merged") is not True:
        reasons.append("DEPENDENCIES_UNVERIFIED")

    if any(x.startswith("CI_FAILED") for x in reasons) or "TRUSTED_CHANGES_REQUESTED" in reasons:
        handoff = "AUTHOR_REPAIR_REQUIRED"
    elif any(x.startswith("CI_PENDING") or x.startswith("REQUIRED_CHECKS_MISSING") for x in reasons):
        handoff = "AWAIT_CI"
    elif "INDEPENDENT_REVIEW_MISSING" in reasons:
        handoff = "AWAIT_INDEPENDENT_REVIEW"
    else:
        handoff = "OWNER_REVIEW_REQUIRED"

    return {
        "mode": "READ_ONLY_ADVISORY",
        "pr_number": pr["number"],
        "head_sha": sha,
        "handoff": handoff,
        "reasons": reasons,
        "trusted_reviewers_observed": sorted(verdicts),
        "eligible_for_automatic_merge": False,
        "actions_executed": [],
    }


def github_get(path: str, token: str):
    req = Request(
        "https://api.github.com/" + path,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "flowtally-agent-handoff-readonly",
            **({"Authorization": "Bearer " + token} if token else {}),
        },
    )
    with urlopen(req, timeout=20) as response:
        return json.load(response)


def github_pages(path: str, token: str) -> list:
    items = []
    for page in range(1, 11):
        separator = "&" if "?" in path else "?"
        batch = github_get(path + separator + "per_page=100&page=" + str(page), token)
        if not isinstance(batch, list):
            raise ValueError("Expected paginated GitHub array")
        items.extend(batch)
        if len(batch) < 100:
            return items
    raise ValueError("Pagination limit exceeded; refusing incomplete audit")


def fetch_snapshot(repository: str, pr_number: int, token: str) -> dict:
    prefix = "repos/" + repository
    pr = github_get(f"{prefix}/pulls/{pr_number}", token)
    sha = pr["head"]["sha"]
    check_response = github_get(f"{prefix}/commits/{sha}/check-runs?per_page=100", token)
    if check_response.get("total_count", 0) > len(check_response.get("check_runs", [])):
        raise ValueError("Check-runs pagination needed; refusing incomplete audit")
    files = github_pages(f"{prefix}/pulls/{pr_number}/files", token)
    comments = github_pages(f"{prefix}/issues/{pr_number}/comments", token)
    reviews = github_pages(f"{prefix}/pulls/{pr_number}/reviews", token)
    return {
        "repository": repository,
        "pr": pr,
        "checks": check_response.get("check_runs", []),
        "changed_files": [f["filename"] for f in files],
        "comments": comments,
        "reviews": reviews,
        # These cannot be proven via this REST-only preflight; fail closed.
        "open_review_threads": None,
        "canonical_claim_verified": None,
        "dependencies_merged": None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True, help="owner/name")
    parser.add_argument("--pr", required=True, type=int)
    parser.add_argument("--trusted-reviewers", default="", help="comma-separated distinct GitHub logins")
    parser.add_argument("--snapshot", help="optional local JSON fixture; skips all network calls")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository) or args.pr < 1:
        parser.error("Invalid repository or PR number")
    try:
        if args.snapshot:
            with open(args.snapshot, encoding="utf-8") as file:
                snapshot = json.load(file)
        else:
            snapshot = fetch_snapshot(args.repository, args.pr, os.getenv("GITHUB_TOKEN", ""))
        if snapshot.get("repository") != args.repository or snapshot["pr"]["number"] != args.pr:
            raise ValueError("Snapshot identity mismatch")
        report = evaluate(snapshot, set(args.trusted_reviewers.split(",")))
    except (HTTPError, URLError, ValueError, KeyError, OSError) as exc:
        print(json.dumps({"mode": "READ_ONLY_ADVISORY", "error": str(exc),
                          "eligible_for_automatic_merge": False, "actions_executed": []}), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
