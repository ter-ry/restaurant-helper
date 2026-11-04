---
name: flowtally-pr-repair
description: Continue and repair an existing Flowtally pull request - inspect exact HEAD, CI and review findings, confirm ownership, fix attributable failures on the same branch and request review of the new SHA. Use when asked to fix, continue, unblock or address review on a PR, or when a PR event reports red CI or review comments.
---

# Flowtally PR repair

Rules (ownership, no force-push of others' work, author duties, no self-approval, no merge/deploy) are in `AGENTS.md`. This is the order of operations. Use MCP tools or `gh api` (REST); GraphQL is blocked.

## 1. Snapshot (never from memory or docs)

For PR `N`: `pull_request_read` `get` (head ref, head SHA, mergeable state, draft), `get_check_runs`, `get_reviews`, `get_review_comments`, `get_comments`. Note the SHA each review covered versus current head. Linked issue: read labels, claim comment and any `OWNER DECISION:`.

## 2. Ownership gate

Continue only if one holds: the branch/PR is this session's own (`claude/*` with this session's claim), or the owner/issue explicitly asks you to take it over.
Stop and report (do not push) if: another agent holds `status:in-progress`, the PR is listed as another agent's in `docs/RELEASE_STATUS.md`, the branch had pushes in the last few minutes (`list_commits`/`git log origin/<branch>`) suggesting an active session, or the PR is merged/closed. If a merged PR needs follow-up, start a fresh branch from main per the session git rules. Never open a second PR for the same issue.

## 3. Reproduce

`git fetch origin <branch> main`; check out the branch (fast-forward only). Get failing job logs (`gh run view --log-failed` or `get_job_logs`) and reproduce locally with the `flowtally-verify` recipe. Use its main-baseline step to decide whether each failure is attributable to this PR or pre-existing on main.

## 4. Fix

- Fix only attributable CI failures and review findings; stay in the PR's scope. Pre-existing main failures: document, do not mask.
- Never skip/weaken tests, edit workflows or force-push. Pull in main with a merge or fast-forward unless the owner of the branch (you) chose rebase and the branch is solely yours (`--force-with-lease` only then).
- Each finding gets a reply: fixed (SHA), disputed (evidence) or deferred (linked issue, owner approval if scope). Financial/POS/DB/security/inventory fixes keep their real-path tests.

## 5. Verify and push

Rerun the failing checks, then the CI-equivalent suites for touched areas (`flowtally-verify`). Commit, `git push -u origin <branch>`. Re-read CI for the new SHA.

## 6. Hand back

Post a PR comment: new head SHA, what changed, commands and results, finding-by-finding status, CI link, and an explicit request for independent review of that SHA (another agent session or the owner; never self-review or self-approve). Update the issue label (`status:review-ready` only with green CI). Update `docs/RELEASE_STATUS.md` only for your own rows. Do not merge, enable auto-merge or deploy. Finish with the completion report from `AGENTS.md`.
