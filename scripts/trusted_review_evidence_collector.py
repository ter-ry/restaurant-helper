"""Fail-closed, read-only GitHub evidence collector for the trusted reviewer Phase 1 (issue #284).

Pure normalizer over an *injected* read-only transport. This module performs no network,
file or environment access, holds no credential and posts nothing. It turns documented
GitHub REST/GraphQL response shapes into the evidence mapping consumed by
``trusted_review_attestation.verify``. PR text (title, body, commit messages, review bodies)
is treated as data: it is only parsed for the signed-attestation block (by the verifier) and
for ``Claude-Session`` trailers, never executed or interpreted as instructions.

Any missing, truncated, rate-limited, unauthorized, ambiguous or racing response makes the
result ``incomplete=True`` with ``api_errors`` (the verifier rejects that). Nothing here
authorizes a merge or proves live GitHub behavior.

Transport contract (read-only):
    transport.get(path: str, params: dict) -> {"status": int, "headers": dict, "body": Any}
    transport.graphql(query: str, variables: dict) -> {"status": int, "headers": dict, "body": Any}
"""
from __future__ import annotations

import re
from typing import Any, Mapping

PER_PAGE = 100
MAX_PAGES = 30
MAX_ATTEMPTS = 2  # one retry, only for transient 5xx; no sleeping here
GITHUB_FILES_CAP = 3000  # the PR files API silently stops at 3000 files
REQUIRED_CHECKS = ("backend", "frontend")
TRUSTED_CHECK_APP = "github-actions"
KILL_SWITCH_VARIABLE = "FLOWTALLY_TRUSTED_REVIEW_ENABLED"
_SHA = re.compile(r"^[0-9a-f]{40}$")
_SESSION_TRAILER = re.compile(r"^Claude-Session:\s*(\S+)\s*$", re.I | re.M)
_COAUTHOR_TRAILER = re.compile(r"^Co-authored-by:\s*([^<\r\n]*?)\s*(?:<([^>\r\n]*)>)?\s*$", re.I | re.M)
_NOREPLY = re.compile(r"^(?:\d+\+)?([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?)@users\.noreply\.github\.com$", re.I)

THREADS_QUERY = (
    "query($owner:String!,$repo:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$repo)"
    "{pullRequest(number:$pr){reviewThreads(first:100,after:$after){totalCount "
    "pageInfo{hasNextPage endCursor} nodes{isResolved isOutdated}}}}}"
)


class Incomplete(Exception):
    """Raised internally; converted to an api_errors entry so evidence fails closed."""


def _is_sha(v: Any) -> bool:
    return isinstance(v, str) and bool(_SHA.match(v))


class Collector:
    def __init__(self, transport: Any, *, repository: str, repo_id: int, allowed_bases: tuple[str, ...] | list[str],
                 trusted_coauthor_emails: tuple[str, ...] | list[str] = ()):
        if not isinstance(repository, str) or repository.count("/") != 1:
            raise ValueError("repository must be 'owner/name'")
        self._t = transport
        self.repository = repository
        self.owner, self.repo = repository.split("/")
        self.repo_id = repo_id
        self.allowed_bases = tuple(allowed_bases)
        # Emails of non-account co-author labels (e.g. an AI assistant's noreply address) the owner has vetted.
        self.trusted_coauthor_emails = frozenset(e.lower() for e in trusted_coauthor_emails)

    # ---- transport helpers ----
    def _check(self, resp: Any, what: str) -> Any:
        if not isinstance(resp, Mapping) or not isinstance(resp.get("status"), int):
            raise Incomplete(f"{what}:malformed_response")
        status, headers = resp["status"], resp.get("headers") or {}
        lower = {str(k).lower(): v for k, v in headers.items()} if isinstance(headers, Mapping) else {}
        if status in (401, 403, 429) or lower.get("x-ratelimit-remaining") == "0":
            raise Incomplete(f"{what}:rate_limited_or_unauthorized:{status}")
        if status != 200:
            raise Incomplete(f"{what}:http_{status}")
        return resp.get("body")

    def _get(self, path: str, params: dict | None, what: str) -> Any:
        last: Incomplete | None = None
        for _ in range(MAX_ATTEMPTS):
            try:
                resp = self._t.get(path, dict(params or {}))
            except Exception as exc:  # noqa: BLE001 - transport failure fails closed
                last = Incomplete(f"{what}:transport_error:{type(exc).__name__}")
                continue
            if isinstance(resp, Mapping) and isinstance(resp.get("status"), int) and 500 <= resp["status"] < 600:
                last = Incomplete(f"{what}:http_{resp['status']}")
                continue
            return self._check(resp, what)
        raise last or Incomplete(f"{what}:unavailable")

    def _pages(self, path: str, what: str, key: str | None = None, params: dict | None = None) -> list[Any]:
        """All pages; truncation (page cap hit) or a short/inconsistent count fails closed."""
        items: list[Any] = []
        total = None
        for page in range(1, MAX_PAGES + 1):
            body = self._get(path, {**(params or {}), "per_page": PER_PAGE, "page": page}, f"{what}:p{page}")
            if key:
                if not isinstance(body, Mapping) or not isinstance(body.get(key), list):
                    raise Incomplete(f"{what}:bad_shape")
                if isinstance(body.get("total_count"), int):
                    total = body["total_count"]
                chunk = body[key]
            else:
                if not isinstance(body, list):
                    raise Incomplete(f"{what}:bad_shape")
                chunk = body
            items.extend(chunk)
            if len(chunk) < PER_PAGE:
                if total is not None and total != len(items):
                    raise Incomplete(f"{what}:count_mismatch")
                return items
        raise Incomplete(f"{what}:truncated")

    # ---- collection ----
    def collect(self, pr_number: int) -> dict[str, Any]:
        errors: list[str] = []
        evidence: dict[str, Any] = {"repository": self.repository}
        try:
            self._collect(pr_number, evidence)
        except Incomplete as exc:
            errors.append(str(exc))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"collector_error:{type(exc).__name__}")
        errors.extend(evidence.pop("_errors", []))
        evidence["api_errors"] = list(dict.fromkeys(errors))
        evidence["incomplete"] = bool(errors)
        return evidence

    def _pr_summary(self, pr: Any) -> dict[str, Any]:
        if not isinstance(pr, Mapping) or pr.get("number") is None:
            raise Incomplete("pr:bad_shape")
        base, head = pr.get("base") or {}, pr.get("head") or {}
        if not (_is_sha(head.get("sha")) and _is_sha(base.get("sha"))):
            raise Incomplete("pr:invalid_shas")
        base_repo = base.get("repo") or {}
        if base_repo.get("full_name") != self.repository or base_repo.get("id") != self.repo_id:
            raise Incomplete("pr:wrong_repository")
        hr = head.get("repo")
        return {"number": pr["number"], "state": pr.get("state"), "draft": pr.get("draft"),
                "user": {"login": (pr.get("user") or {}).get("login")},
                "base": {"ref": base.get("ref"), "sha": base["sha"]},
                "head": {"sha": head["sha"], "repo": ({"full_name": hr.get("full_name"), "id": hr.get("id")} if isinstance(hr, Mapping) else None)},
                "_changed_files": pr.get("changed_files"), "_commits": pr.get("commits")}

    def _collect(self, n: int, ev: dict[str, Any]) -> None:
        if isinstance(n, bool) or not isinstance(n, int) or n <= 0:
            raise Incomplete("pr:invalid_number")
        root = f"/repos/{self.owner}/{self.repo}"
        pr = self._pr_summary(self._get(f"{root}/pulls/{n}", None, "pr"))
        head, base = pr["head"]["sha"], pr["base"]["sha"]
        expected_files = pr.pop("_changed_files")
        expected_commits = pr.pop("_commits")
        ev["pr"] = pr

        var = self._get(f"{root}/actions/variables/{KILL_SWITCH_VARIABLE}", None, "variables")
        if not isinstance(var, Mapping) or var.get("name") != KILL_SWITCH_VARIABLE or not isinstance(var.get("value"), str):
            raise Incomplete("variables:bad_shape")
        ev["variables"] = {KILL_SWITCH_VARIABLE: var["value"]}

        # Formal reviews (all pages): the verifier selects by pinned numeric bot id.
        reviews = []
        for r in self._pages(f"{root}/pulls/{n}/reviews", "reviews"):
            if not isinstance(r, Mapping):
                raise Incomplete("reviews:bad_shape")
            u = r.get("user")
            reviews.append({"id": r.get("id"), "state": r.get("state"), "commit_id": r.get("commit_id"),
                            "submitted_at": r.get("submitted_at"), "body": r.get("body"),
                            "user": ({"id": u.get("id"), "login": u.get("login"), "type": u.get("type")} if isinstance(u, Mapping) else None)})
        ev["reviews"] = reviews

        # Requested reviewers: users and teams both count as pending.
        rr = self._get(f"{root}/pulls/{n}/requested_reviewers", None, "requested_reviewers")
        if not isinstance(rr, Mapping) or not isinstance(rr.get("users"), list) or not isinstance(rr.get("teams"), list):
            raise Incomplete("requested_reviewers:bad_shape")
        ev["requested_reviewers"] = [u.get("login") for u in rr["users"] if isinstance(u, Mapping)] + \
                                    [f"team:{t.get('slug')}" for t in rr["teams"] if isinstance(t, Mapping)]
        if len(ev["requested_reviewers"]) != len(rr["users"]) + len(rr["teams"]):
            raise Incomplete("requested_reviewers:bad_shape")

        # Changed files, including rename sources (a rename out of a protected path must stay visible).
        files: list[str] = []
        records = self._pages(f"{root}/pulls/{n}/files", "files")
        if isinstance(expected_files, bool) or not isinstance(expected_files, int) or expected_files != len(records):
            raise Incomplete("files:count_mismatch_with_pr")
        for f in records:
            if not isinstance(f, Mapping) or not isinstance(f.get("filename"), str) or not f["filename"]:
                raise Incomplete("files:bad_shape")
            files.append(f["filename"])
            if f.get("previous_filename"):
                files.append(f["previous_filename"])
        if not files or len(files) >= GITHUB_FILES_CAP:
            raise Incomplete("files:missing_or_capped")
        ev["changed_files"] = sorted(set(files))

        self._commits(root, n, ev, expected_commits)
        self._threads(n, ev)
        self._checks(root, n, head, base, ev)

        # Race recheck: head/base/state must be unchanged after every other read.
        again = self._pr_summary(self._get(f"{root}/pulls/{n}", None, "pr_recheck"))
        again.pop("_changed_files")
        again.pop("_commits")
        if again["head"]["sha"] != head or again["base"]["sha"] != base or again["base"]["ref"] != pr["base"]["ref"] or again["state"] != pr["state"] or again["draft"] != pr["draft"]:
            raise Incomplete("race:pr_changed_during_collection")

    def _commits(self, root: str, n: int, ev: dict[str, Any], expected: Any) -> None:
        authors: list[str] = []
        sessions: list[str] = []
        errs: list[str] = []
        records = self._pages(f"{root}/pulls/{n}/commits", "commits")
        # the endpoint silently caps at 250 commits: any count mismatch means omitted authors
        if isinstance(expected, bool) or not isinstance(expected, int) or expected != len(records):
            raise Incomplete("commits:count_mismatch_with_pr")
        for c in records:
            if not isinstance(c, Mapping) or not isinstance(c.get("commit"), Mapping):
                raise Incomplete("commits:bad_shape")
            msg = c["commit"].get("message")
            if not isinstance(msg, str):
                raise Incomplete("commits:bad_shape")
            for who in ("author", "committer"):
                login = (c.get(who) or {}).get("login")
                if isinstance(login, str) and login:
                    authors.append(login)
                elif who == "author":
                    errs.append("commits:author_not_linked_to_account")  # ambiguous: cannot prove who wrote it
            for name, email in _COAUTHOR_TRAILER.findall(msg):
                email = email.strip().lower()
                m = _NOREPLY.match(email)
                if m:
                    authors.append(m.group(1))  # account identity from the noreply address, never the display name
                    if name.strip():
                        authors.append(name.strip())
                elif email and email in self.trusted_coauthor_emails and name.strip():
                    authors.append(name.strip())
                else:
                    # a display name alone is not an account identity: fail closed rather than trust it
                    errs.append("commits:coauthor_identity_unresolved")
                    if name.strip():
                        authors.append(name.strip())
            found = [s.rstrip("/").rsplit("/", 1)[-1] for s in _SESSION_TRAILER.findall(msg)]
            if found:
                sessions.extend(found)
            else:
                errs.append("commits:author_session_unattributed")
        ev["commit_authors"] = sorted(set(authors))
        ev["author_session_ids"] = sorted(set(sessions))
        if errs:
            ev.setdefault("_errors", []).extend(errs)
        if not ev["commit_authors"] or not ev["author_session_ids"]:
            raise Incomplete("commits:author_identity_undetermined")

    def _threads(self, n: int, ev: dict[str, Any]) -> None:
        threads: list[dict[str, Any]] = []
        after, total = None, None
        for _ in range(MAX_PAGES):
            resp = self._t.graphql(THREADS_QUERY, {"owner": self.owner, "repo": self.repo, "pr": n, "after": after})
            body = self._check(resp, "threads")
            if not isinstance(body, Mapping) or body.get("errors") or not isinstance(body.get("data"), Mapping):
                raise Incomplete("threads:graphql_error")
            rt = ((((body["data"].get("repository") or {}).get("pullRequest")) or {}).get("reviewThreads"))
            if not isinstance(rt, Mapping) or not isinstance(rt.get("nodes"), list) or not isinstance(rt.get("pageInfo"), Mapping):
                raise Incomplete("threads:bad_shape")
            total = rt.get("totalCount")
            for node in rt["nodes"]:
                if not isinstance(node, Mapping) or not isinstance(node.get("isResolved"), bool) or not isinstance(node.get("isOutdated"), bool):
                    raise Incomplete("threads:bad_shape")
                # outdated threads are still threads: only an explicit resolution clears them
                threads.append({"is_resolved": node["isResolved"], "is_outdated": node["isOutdated"]})
            pi = rt["pageInfo"]
            if not pi.get("hasNextPage"):
                if not isinstance(total, int) or total != len(threads):
                    raise Incomplete("threads:count_mismatch")
                ev["threads"] = threads
                return
            after = pi.get("endCursor")
            if not after:
                raise Incomplete("threads:bad_cursor")
        raise Incomplete("threads:truncated")

    def _checks(self, root: str, n: int, head: str, base: str, ev: dict[str, Any]) -> None:
        raw = self._pages(f"{root}/commits/{head}/check-runs", "check_runs", key="check_runs")
        runs_by_suite: dict[Any, Mapping[str, Any]] | None = None
        out: list[dict[str, Any]] = []
        for cr in raw:
            if not isinstance(cr, Mapping) or not isinstance(cr.get("name"), str):
                raise Incomplete("check_runs:bad_shape")
            app = cr.get("app") if isinstance(cr.get("app"), Mapping) else {}
            entry = {"name": cr["name"], "head_sha": cr.get("head_sha"), "status": cr.get("status"),
                     "conclusion": cr.get("conclusion"), "app": {"slug": app.get("slug"), "id": app.get("id")}}
            if cr["name"] in REQUIRED_CHECKS and app.get("slug") == TRUSTED_CHECK_APP and cr.get("head_sha") == head:
                if runs_by_suite is None:
                    runs_by_suite = self._workflow_runs(root, head)
                bsha = self._base_for(cr, runs_by_suite, n, head)
                if bsha is not None:
                    entry["base_sha"] = bsha
                else:
                    ev.setdefault("unverified", []).append(f"base_sha_unproven:{cr['name']}")
            out.append(entry)
        for name in REQUIRED_CHECKS:
            if sum(1 for r in out if r["name"] == name) > 1:
                ev.setdefault("_errors", []).append(f"check_runs:duplicate_name:{name}")  # reruns are ambiguous: fail closed
        ev["check_runs"] = out

    def _workflow_runs(self, root: str, head: str) -> dict[Any, Mapping[str, Any]]:
        runs = self._pages(f"{root}/actions/runs", "workflow_runs", key="workflow_runs",
                           params={"head_sha": head, "event": "pull_request"})
        by_suite: dict[Any, Mapping[str, Any]] = {}
        for r in runs:
            if not isinstance(r, Mapping):
                raise Incomplete("workflow_runs:bad_shape")
            sid = r.get("check_suite_id")
            if sid in by_suite:
                by_suite[sid] = {}  # two runs share a suite: ambiguous, never trusted
            else:
                by_suite[sid] = r
        return by_suite

    def _base_for(self, cr: Mapping[str, Any], by_suite: Mapping[Any, Mapping[str, Any]], n: int, head: str) -> str | None:
        """base_sha provenance: the trusted `pull_request` workflow run that produced this exact check run
        records the PR base at trigger time. Anything less than one unambiguous match returns None (unproven)."""
        sid = (cr.get("check_suite") or {}).get("id")
        run = by_suite.get(sid) if sid is not None else None
        if not run or run.get("event") != "pull_request" or run.get("head_sha") != head:
            return None
        if (run.get("repository") or {}).get("id") != self.repo_id or (run.get("head_repository") or {}).get("id") != self.repo_id:
            return None
        prs = run.get("pull_requests")
        if not isinstance(prs, list) or len(prs) != 1 or not isinstance(prs[0], Mapping) or prs[0].get("number") != n:
            return None
        base = prs[0].get("base") or {}
        if base.get("ref") not in self.allowed_bases or (base.get("repo") or {}).get("id") != self.repo_id or not _is_sha(base.get("sha")):
            return None
        return base["sha"]
