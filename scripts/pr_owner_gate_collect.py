#!/usr/bin/env python3
"""Collect a PR gate snapshot using GitHub REST; never evaluates PR code."""
from __future__ import annotations
import argparse, json, os
from urllib.request import Request, urlopen

def get(path, token):
    request = Request("https://api.github.com/" + path, headers={"Accept": "application/vnd.github+json", "Authorization": "Bearer " + token, "User-Agent": "flowtally-pr-owner-gate"})
    with urlopen(request, timeout=20) as response: return json.load(response)

def post_graphql(query, variables, token):
    request = Request("https://api.github.com/graphql", data=json.dumps({"query": query, "variables": variables}).encode(), method="POST", headers={"Accept": "application/vnd.github+json", "Content-Type": "application/json", "Authorization": "Bearer " + token, "User-Agent": "flowtally-pr-owner-gate"})
    with urlopen(request, timeout=20) as response: return json.load(response)

def pages(path, token):
    result = []
    for page in range(1, 11):
        batch = get(path + f"?per_page=100&page={page}", token); result.extend(batch)
        if len(batch) < 100: return result
    raise RuntimeError("pagination limit exceeded")

def main():
    p = argparse.ArgumentParser(); p.add_argument("--repository", required=True); p.add_argument("--pr", required=True, type=int); p.add_argument("--required-checks", default=""); p.add_argument("--release-policy-checks", default=""); p.add_argument("--trusted-reviewers", default=""); p.add_argument("--owner-login", default=""); p.add_argument("--output", required=True); a = p.parse_args()
    token = os.environ["GH_TOKEN"]; prefix = "repos/" + a.repository; pr = get(f"{prefix}/pulls/{a.pr}", token); sha = pr["head"]["sha"]
    checks = get(f"{prefix}/commits/{sha}/check-runs?per_page=100", token).get("check_runs", [])
    reviews = pages(f"{prefix}/pulls/{a.pr}/reviews", token); comments = pages(f"{prefix}/issues/{a.pr}/comments", token); files = pages(f"{prefix}/pulls/{a.pr}/files", token)
    unresolved = None
    try:
        owner, name = a.repository.split("/", 1)
        query = """query($owner:String!, $name:String!, $number:Int!) { repository(owner:$owner, name:$name) { pullRequest(number:$number) { reviewThreads(first:100) { nodes { isResolved isOutdated comments(first:1) { nodes { databaseId } } } } } } }"""
        data = post_graphql(query, {"owner": owner, "name": name, "number": a.pr}, token)
        nodes = data.get("data", {}).get("repository", {}).get("pullRequest", {}).get("reviewThreads", {}).get("nodes", [])
        unresolved = [node for node in nodes if not node.get("isResolved") and not node.get("isOutdated")]
    except Exception:
        pass
    snapshot = {"repository": a.repository, "pr": pr, "checks": checks, "reviews": reviews, "comments": comments, "changed_files": [item["filename"] for item in files], "unresolved_review_findings": unresolved, "config": {"required_checks": a.required_checks, "release_policy_checks": a.release_policy_checks, "trusted_reviewers": a.trusted_reviewers, "owner_mention": "@" + a.owner_login if a.owner_login else "@owner"}}
    with open(a.output, "w", encoding="utf-8") as handle: json.dump(snapshot, handle)
if __name__ == "__main__": main()
