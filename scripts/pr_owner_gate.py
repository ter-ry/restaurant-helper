#!/usr/bin/env python3
"""Evaluate and, optionally, reconcile a PR owner-notification gate.

The evaluator is deliberately portable: CI can pass a JSON snapshot with
``--snapshot`` or the script can collect the same evidence from GitHub REST.
It never checks out or executes the PR head.  Mutations are opt-in with
``--write`` and are limited to one label and one issue comment.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from agent_handoff_audit import is_high_risk

STATES = ("BLOCKED", "REVIEW IN PROGRESS", "OWNER REVIEW NEEDED", "VERIFIED FOR OWNER DECISION")
MARKER = "<!-- flowtally-owner-gate"
DEFAULT_CHECKS = ("backend", "frontend")
HIGH_RISK = ("financial", "inventory", "pos", "security", "migration")


def csv(value: str | None) -> set[str]:
    return {item.strip().lower() for item in (value or "").split(",") if item.strip()}


def matches_high_risk(paths: list[str], patterns: set[str]) -> bool:
    """High risk by explicit repository path coverage, plus keyword backstop.

    ``is_high_risk`` (shared with the handoff audit) covers modules such as
    ``backend/auth.py`` or ``backend/daily_close.py`` that contain no category
    words; the keyword patterns only ever make the gate stricter.
    """
    if is_high_risk(list(paths)):
        return True
    lowered = [path.lower() for path in paths]
    return any(any(pattern in path for pattern in patterns) for path in lowered)


def pending_reviewers(snapshot: dict) -> set[str]:
    """Outstanding review requests from the snapshot and the collected PR."""
    pending = {str(name) for name in snapshot.get("pending_reviewers") or []}
    pr = snapshot.get("pr", {})
    for user in pr.get("requested_reviewers") or []:
        if user.get("login"):
            pending.add(user["login"])
    for team in pr.get("requested_teams") or []:
        if team.get("slug"):
            pending.add("team:" + team["slug"])
    return pending


def resolve_token(env=None) -> str:
    """The workflow exports GH_TOKEN; accept GITHUB_TOKEN as well."""
    env = os.environ if env is None else env
    return env.get("GITHUB_TOKEN") or env.get("GH_TOKEN") or ""


def _check_map(snapshot: dict, sha: str) -> dict[str, dict]:
    result = {}
    for check in snapshot.get("checks", []):
        name = (check.get("name") or "").split(" / ")[0]
        if check.get("head_sha") == sha:
            result[name] = check
    return result


def _review_provenance(snapshot: dict, sha: str, trusted: set[str], author: str) -> dict[str, str]:
    """Return the latest formal verdict per distinct GitHub account.

    Issue comments are intentionally not approvals.  This prevents two agents
    using the same GitHub account (for example Claude and Codex) from satisfying
    an independent-review requirement.
    """
    verdicts: dict[str, tuple[str, str]] = {}
    for review in snapshot.get("reviews", []):
        login = (review.get("user", {}).get("login") or "").lower()
        if login not in trusted or login == author or review.get("commit_id") != sha:
            continue
        state = (review.get("state") or "").upper()
        value = {"APPROVED": "APPROVE", "CHANGES_REQUESTED": "REQUEST CHANGES"}.get(state)
        if not value:
            continue
        timestamp = review.get("submitted_at") or ""
        if login not in verdicts or timestamp >= verdicts[login][0]:
            verdicts[login] = (timestamp, value)
    return {login: value for login, (_, value) in verdicts.items()}


def evaluate(snapshot: dict, config: dict | None = None) -> dict:
    config = config or snapshot.get("config", {})
    pr = snapshot["pr"]
    sha = pr["head"]["sha"]
    author = (pr.get("user", {}).get("login") or "").lower()
    trusted = csv(config.get("trusted_reviewers"))
    required_checks = csv(config.get("required_checks")) or set(DEFAULT_CHECKS)
    policy_checks = csv(config.get("release_policy_checks"))
    high_risk_patterns = csv(config.get("high_risk_patterns")) or set(HIGH_RISK)
    reasons: list[str] = []
    checks = _check_map(snapshot, sha)
    reviews = _review_provenance(snapshot, sha, trusted, author)
    high_risk = matches_high_risk(snapshot.get("changed_files", []), high_risk_patterns)

    if pr.get("state") != "open" or pr.get("draft") or pr.get("base", {}).get("ref") != "main":
        reasons.append("PR_NOT_OPEN_READY_ON_MAIN")
    if pr.get("head", {}).get("repo", {}).get("full_name") != snapshot.get("repository"):
        reasons.append("UNSUPPORTED_FORK_HEAD")
    mergeable = pr.get("mergeable")
    merge_state = (pr.get("mergeable_state") or "").lower()
    if mergeable is False or merge_state in {"dirty", "blocked", "behind"}:
        reasons.append("MERGEABILITY_BLOCKED")
    elif mergeable is None or merge_state in {"", "unknown", "unstable"}:
        reasons.append("MERGEABILITY_UNVERIFIED")

    missing = sorted(required_checks - checks.keys())
    failed = sorted(name for name in required_checks if name in checks and checks[name].get("conclusion") not in {"success", "neutral"})
    pending = sorted(name for name in required_checks if name in checks and checks[name].get("status") != "completed")
    if missing:
        reasons.append("REQUIRED_CHECKS_MISSING:" + ",".join(missing))
    if failed:
        reasons.append("CI_FAILED:" + ",".join(failed))
    if pending:
        reasons.append("CI_PENDING:" + ",".join(pending))

    policy = _check_map(snapshot, sha)
    missing_policy = sorted(policy_checks - policy.keys())
    failed_policy = sorted(name for name in policy_checks if name in policy and policy[name].get("conclusion") != "success")
    if missing_policy:
        reasons.append("RELEASE_POLICY_CHECKS_MISSING:" + ",".join(missing_policy))
    if failed_policy:
        reasons.append("RELEASE_POLICY_FAILED:" + ",".join(failed_policy))

    findings = snapshot.get("unresolved_review_findings")
    if findings is None:
        reasons.append("UNRESOLVED_FINDINGS_UNVERIFIED")
    elif findings:
        reasons.append("OPEN_REVIEW_FINDINGS:" + str(len(findings)))
    if snapshot.get("review_conflict"):
        reasons.append("REVIEW_OWNERSHIP_CONFLICT")
    pending_review = pending_reviewers(snapshot)
    if pending_review:
        reasons.append("REVIEW_PENDING:" + ",".join(sorted(pending_review)))

    if any(value == "REQUEST CHANGES" for value in reviews.values()):
        reasons.append("TRUSTED_CHANGES_REQUESTED")
    approvals = sum(value == "APPROVE" for value in reviews.values())
    needed = int(config.get("independent_reviews_high_risk" if high_risk else "independent_reviews") or 1)
    if approvals < needed:
        reasons.append(f"INDEPENDENT_REVIEW_MISSING:{approvals}/{needed}")
    if high_risk:
        reasons.append("HIGH_RISK_OWNER_GATE")

    blocking_prefixes = ("PR_", "UNSUPPORTED", "MERGEABILITY", "CI_FAILED", "RELEASE_POLICY_FAILED", "OPEN_REVIEW", "UNRESOLVED", "TRUSTED_", "REVIEW_", "REQUIRED_CHECKS_MISSING")
    if any(reason.startswith(prefix) for reason in reasons for prefix in blocking_prefixes):
        state = "BLOCKED"
    elif any(reason.startswith(prefix) for reason in reasons for prefix in ("CI_PENDING", "RELEASE_POLICY_CHECKS_MISSING", "INDEPENDENT_REVIEW_MISSING")):
        state = "REVIEW IN PROGRESS"
    elif high_risk or snapshot.get("owner_decision_required"):
        state = "OWNER REVIEW NEEDED"
    else:
        state = "VERIFIED FOR OWNER DECISION"
    return {
        "state": state,
        "pr_number": pr["number"],
        "head_sha": sha,
        "url": pr.get("html_url", ""),
        "ci": {name: checks.get(name, {}).get("conclusion", "missing") for name in sorted(required_checks)},
        "review_evidence": {"formal_approvals": sorted(login for login, value in reviews.items() if value == "APPROVE"), "required": needed},
        "outstanding_risks": reasons,
        "high_risk": high_risk,
    }


def notification(report: dict, owner_mention: str) -> str:
    marker = f"{MARKER} pr={report['pr_number']} sha={report['head_sha']} state={report['state']} -->"
    ci = ", ".join(f"{key}={value}" for key, value in report["ci"].items())
    reviews = ", ".join(report["review_evidence"]["formal_approvals"]) or "none"
    risks = ", ".join(report["outstanding_risks"]) or "none"
    return (f"{marker}\n{owner_mention} Flowtally PR #{report['pr_number']} is **{report['state']}**.\n"
            f"URL: {report['url']}\nSHA: `{report['head_sha']}`\nCI: {ci}\n"
            f"Formal review evidence: {reviews} (required {report['review_evidence']['required']})\n"
            f"Outstanding risks: {risks}\nPlease review and merge only after your own decision.")


def github_request(method: str, path: str, token: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = Request("https://api.github.com/" + path, data=data, method=method, headers={
        "Accept": "application/vnd.github+json", "Content-Type": "application/json",
        "User-Agent": "flowtally-pr-owner-gate", "Authorization": "Bearer " + token,
    })
    with urlopen(req, timeout=20) as response:
        return json.load(response) if response.status != 204 else {}


def remove_label(repository: str, number: int, label: str, token: str) -> None:
    """DELETE the label; an already-absent label is a successful cleanup."""
    try:
        github_request("DELETE", f"repos/{repository}/issues/{number}/labels/{quote(label, safe='')}", token)
    except HTTPError as exc:
        if exc.code != 404:
            raise


def is_active_notification(body: str, current_marker: str) -> bool:
    """A matching marker only deduplicates while the comment is not withdrawn."""
    return MARKER in body and current_marker in body and "WITHDRAWN" not in body


def reconcile(snapshot: dict, report: dict, config: dict, token: str, write: bool) -> dict:
    if not write:
        return {"write": False, "would_notify": report["state"] in {"OWNER REVIEW NEEDED", "VERIFIED FOR OWNER DECISION"}, "notification": notification(report, config.get("owner_mention", "@owner"))}
    repository = snapshot["repository"]
    number = report["pr_number"]
    label = config.get("owner_label", "owner-review-needed")
    comments = snapshot.get("comments", [])
    current_marker = f"sha={report['head_sha']} state={report['state']}"
    already = any(is_active_notification(comment.get("body") or "", current_marker) for comment in comments)
    eligible = report["state"] in {"OWNER REVIEW NEEDED", "VERIFIED FOR OWNER DECISION"}
    if eligible:
        github_request("POST", f"repos/{repository}/issues/{number}/labels", token, {"labels": [label]})
        if not already:
            github_request("POST", f"repos/{repository}/issues/{number}/comments", token, {"body": notification(report, config.get("owner_mention", "@owner"))})
    else:
        remove_label(repository, number, label, token)
        # Do not add noise for ordinary CI progress or a still-known blocker.
        old_ready = [comment for comment in comments if MARKER in (comment.get("body") or "") and ("state=OWNER REVIEW NEEDED" in comment["body"] or "state=VERIFIED FOR OWNER DECISION" in comment["body"])]
        for comment in old_ready:
            body = comment.get("body", "")
            if "WITHDRAWN" not in body:
                github_request("PATCH", f"repos/{repository}/issues/comments/{comment['id']}", token, {"body": body + "\n\n**WITHDRAWN:** the PR head or readiness state changed; reassess the current SHA."})
    return {"write": True, "notified": eligible and not already, "state": report["state"], "deduplicated": already}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    try:
        with open(args.snapshot, encoding="utf-8") as handle:
            snapshot = json.load(handle)
        config = snapshot.get("config", {})
        report = evaluate(snapshot, config)
        token = resolve_token()
        if args.write and not token:
            raise ValueError("write mode requires GITHUB_TOKEN or GH_TOKEN")
        result = reconcile(snapshot, report, config, token, args.write)
        print(json.dumps({"report": report, "reconcile": result}, indent=2, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, HTTPError, URLError) as exc:
        print(json.dumps({"error": str(exc), "state": "BLOCKED"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
