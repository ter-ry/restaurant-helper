#!/usr/bin/env python3
"""Collect a PR gate snapshot using GitHub REST/GraphQL; never evaluates PR code."""
from __future__ import annotations

import argparse
import json
import os
from urllib.request import Request, urlopen

THREADS_QUERY = """query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$name) { pullRequest(number:$number) {
    reviewThreads(first:100, after:$cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { isResolved isOutdated comments(first:1) { nodes { databaseId } } }
    } } } }"""
MAX_THREAD_PAGES = 10


def get(path, token):
    request = Request("https://api.github.com/" + path, headers={"Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "User-Agent": "flowtally-pr-owner-gate"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def post_graphql(query, variables, token):
    request = Request("https://api.github.com/graphql", data=json.dumps({"query": query, "variables": variables}).encode(), method="POST", headers={"Accept": "application/vnd.github+json", "Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": "flowtally-pr-owner-gate"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def pages(path, token, fetch=get):
    result = []
    for page in range(1, 11):
        batch = fetch(path + f"?per_page=100&page={page}", token)
        result.extend(batch)
        if len(batch) < 100:
            return result
    raise RuntimeError("pagination limit exceeded")


def fetch_unresolved_threads(repository, number, token, graphql=post_graphql):
    """Return every unresolved review thread, or ``None`` if that cannot be proven.

    ``None`` makes the evaluator report UNRESOLVED_FINDINGS_UNVERIFIED, so any
    GraphQL error, malformed/partial response or incomplete pagination fails
    closed.  Outdated threads are kept: an outdated diff anchor is not evidence
    that the finding was fixed.
    """
    try:
        owner, name = repository.split("/", 1)
        unresolved, cursor = [], None
        for _ in range(MAX_THREAD_PAGES):
            data = graphql(THREADS_QUERY, {"owner": owner, "name": name, "number": number, "cursor": cursor}, token)
            if not isinstance(data, dict) or data.get("errors"):
                return None
            connection = ((((data.get("data") or {}).get("repository") or {}).get("pullRequest") or {}).get("reviewThreads"))
            if not isinstance(connection, dict) or not isinstance(connection.get("nodes"), list):
                return None
            for node in connection["nodes"]:
                if not isinstance(node, dict) or not isinstance(node.get("isResolved"), bool):
                    return None
                if not node["isResolved"]:
                    unresolved.append(node)
            page_info = connection.get("pageInfo") or {}
            if not page_info.get("hasNextPage"):
                return unresolved
            cursor = page_info.get("endCursor")
            if not cursor:
                return None
        return None  # pagination limit exceeded
    except Exception:
        return None


def requested_reviewers(pr):
    """Outstanding review requests (users and teams) from the PR response."""
    pending = [user["login"] for user in pr.get("requested_reviewers") or [] if user.get("login")]
    pending += ["team:" + team["slug"] for team in pr.get("requested_teams") or [] if team.get("slug")]
    return sorted(pending)


def build_snapshot(repository, number, token, config, rest=get, graphql=post_graphql):
    prefix = "repos/" + repository
    pr = rest(f"{prefix}/pulls/{number}", token)
    sha = pr["head"]["sha"]
    checks = rest(f"{prefix}/commits/{sha}/check-runs?per_page=100", token).get("check_runs", [])
    reviews = pages(f"{prefix}/pulls/{number}/reviews", token, rest)
    comments = pages(f"{prefix}/issues/{number}/comments", token, rest)
    files = pages(f"{prefix}/pulls/{number}/files", token, rest)
    return {
        "repository": repository, "pr": pr, "checks": checks, "reviews": reviews, "comments": comments,
        "changed_files": [item["filename"] for item in files],
        "unresolved_review_findings": fetch_unresolved_threads(repository, number, token, graphql),
        "pending_reviewers": requested_reviewers(pr),
        "config": config,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repository", required=True)
    p.add_argument("--pr", required=True, type=int)
    p.add_argument("--required-checks", default="")
    p.add_argument("--release-policy-checks", default="")
    p.add_argument("--trusted-reviewers", default="")
    p.add_argument("--owner-login", default="")
    p.add_argument("--output", required=True)
    a = p.parse_args()
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GH_TOKEN or GITHUB_TOKEN is required")
    config = {"required_checks": a.required_checks, "release_policy_checks": a.release_policy_checks, "trusted_reviewers": a.trusted_reviewers, "owner_mention": "@" + a.owner_login if a.owner_login else "@owner"}
    snapshot = build_snapshot(a.repository, a.pr, token, config)
    with open(a.output, "w", encoding="utf-8") as handle:
        json.dump(snapshot, handle)


if __name__ == "__main__":
    main()
