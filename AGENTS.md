# Flowtally Repo Guide

## Product Context

Flowtally is a Toronto-focused restaurant back-office control demo for independent restaurants, cafes, bakeries, drink shops, and small catering businesses.

Positioning:
- Flowtally is not a POS replacement.
- It sits between POS, supplier invoices/receipts, inventory, daily close, and accounting/export.
- Core pillars: purchasing control, inventory control, and daily close control.
- Current goal: make the demo clear enough to help win the first pilot customer.

## Important Routes

- `/`
- `/pilot`
- `/demo`
- `/demo/cafe`
- `/demo/cafe/purchases`
- `/demo/cafe/inventory`
- `/demo/cafe/close-reports`
- `/demo/cafe/menu-costing`
- `/demo/cafe/schedule`

## Backend Boundaries

- The authenticated pilot backend lives under `backend/` and starts from `backend.wsgi:app`.
- `app.py`, `Procfile`, and `render.yaml` belong to the legacy root service unless the owner explicitly says otherwise.
- `render.pilot-staging.yaml` and `backend/.env.staging.example` describe the pilot staging service.
- Do not add, delete, move, or commit unrelated untracked files already present in the workspace.

## Working Rules

- Keep changes narrow and high-confidence.
- Do not rewrite unrelated pages.
- Do not invent backend or database persistence unless explicitly asked.
- The demo currently uses browser/local demo data.
- Prioritize clarity for non-technical restaurant owners.
- Avoid making the product look like a student project.
- Keep mobile layout usable.
- Prefer realistic restaurant and cafe sample data.
- User-triggered server mutations must never feel silent: show in-progress, success, and failure states; re-fetch or otherwise reconcile with authoritative server state after success; refresh dependent UI; prevent accidental duplicate submissions; and avoid leaving stale client state that requires a manual browser reload.

## Verification

- Run `npm run build` (`npm.cmd run build` on Windows) before finishing.
- Run the backend test suite and migration checks whenever backend code changes.
- Manually check the relevant routes for any UI or workflow changes.
- Summarize files changed, what changed, build result, and any remaining limitations.

## Git and Release Safety (permanent, applies to Claude Code and Codex)

- Never push directly to `main`. Work on a focused feature branch (`claude/<topic>` or `codex/<topic>`) and open a review-only pull request.
- Never merge a PR, deploy, change production/staging configuration, or modify live data without explicit owner approval in the current session. Approval for one action does not extend to another.
- Merging to `main` triggers the GitHub Pages deploy (`.github/workflows/deploy.yml`); treat every merge as a release action.
- Never expose or commit credentials, tokens, `.env` files or customer data. Use the `*.example` files and placeholders only.
- Do not touch another agent's open PR or branch (check `docs/RELEASE_STATUS.md` for open PRs) unless the owner asks.
- Do not edit `.github/workflows/`, `render*.yaml`, `Procfile` or migrations unless the task is explicitly about them.
- Commit after relevant checks pass. Never skip, disable or quarantine a test to get green.

## Engineering Invariants

- Preserve PostgreSQL RLS (forced), tenant/location isolation and inventory-accounting correctness (movement ledger must reconcile to on-hand; weighted-average cost; idempotent replays).
- Square and Clover are separate adapters behind `backend/pos.py`. Never change Square behavior while implementing Clover; Clover inventory writes stay behind their feature flag, default off.
- Use established patterns (existing blueprints, models, migration style, test fixtures) instead of new architecture. Avoid unrelated refactors, cosmetic churn and repeated whole-repo audits.
- Behavioral changes need meaningful acceptance tests. For financial or inventory mutations, test the real enabled execution path (flag on, real endpoint/service, PostgreSQL where RLS or locking matters), including duplicate/retry and failure cases.
- Fix failures and self-review the diff against the acceptance criteria before presenting a PR. Finish the agreed scope rather than expanding it.

## Agent Workflow

Read this file, then `docs/RELEASE_STATUS.md` (current state and NEXT TASK) before starting. `docs/RELEASE_PLAN.md` holds milestones, priorities and freeze criteria; read it only when planning. Full loop:

1. Follow the Session Start Routine below to select the task (live GitHub state first; `RELEASE_STATUS.md` is a summary).
2. Write testable acceptance criteria first.
3. Implement on an isolated branch from current `main`.
4. Run relevant unit, integration, PostgreSQL/RLS, build and UI checks.
5. Read real failures, repair them, re-run.
6. Self-review the diff.
7. Open a focused review-only PR with test evidence, remaining risks and any approval needed.
8. Check GitHub CI when access permits and fix failures on your own PR.
9. Update `docs/RELEASE_STATUS.md` (only your own rows/evidence; verify other entries are still current before changing them).

Use parallel agents only for independent work with non-overlapping file ownership. Do not spend usage on repeated full-repo scans, duplicate test runs or verbose interim reports. Financial, POS, database, security and inventory PRs should get independent review (another agent session or the owner) before merge.

Cannot proceed without a human or new session: merge, deploy, production/Render/Aiven/DNS/OAuth/Square/Clover console changes, live-data changes, external sandbox actions, pricing/legal/marketing decisions. Record these under "Owner actions" in `RELEASE_STATUS.md` and continue other ready work.

## Work Queue and Claiming

The queue is GitHub issues. Labels: priority `P0`/`P1`/`P2`; state `status:ready`, `status:in-progress`, `status:blocked`, `status:review-ready`; `unattended-ok` (may run unattended), `needs-owner` (agents cannot complete it); area labels.

- Pick the highest-priority `status:ready` issue that is `unattended-ok`, whose dependencies are closed, and that has no open PR or `status:in-progress` claim. If it is blocked, take the next ready one; do not wait.
- Before starting, re-read the issue and check open PRs and branches (`gh api 'repos/ter-ry/restaurant-helper/pulls?state=open'`, `git ls-remote --heads origin`). Claim it: swap `status:ready` for `status:in-progress` and comment your agent name and branch. One agent owns one issue and one PR.
- On PR open with green CI, set `status:review-ready`. If you cannot finish, remove your claim, comment what was done and what remains, and set the label back.
- Never take an issue claimed by another agent. If a claim has no branch or PR, report it to the owner instead of overriding it.
- Never enable Clover inventory writes (`CLOVER_ORDER_INVENTORY_ENABLED`) or touch live data, even to test; use the PostgreSQL test fixtures.
- In cloud sessions GraphQL is blocked: `gh pr list/view` and `gh issue list` fail. Use `gh api` (REST) or the GitHub MCP tools; `gh run list/view` works. See `docs/AUTOMATION_READINESS.md` for the verified environment recipe.

## Shared Agent Coordination Protocol (Claude Code and Codex)

Agents coordinate through GitHub only. The owner is never the message relay between agents; write findings where the other agent will read them.

| Concern | Authoritative location |
|---|---|
| Task ownership, status, dependencies, owner decisions | GitHub issues (labels and comments) |
| Implementation evidence, exact head SHA, test results, review findings | PR description, comments and reviews |
| Agreed feature scope and freeze requirements | `docs/RELEASE_PLAN.md` |
| Release-level progress summary | `docs/RELEASE_STATUS.md` (a snapshot; never overrides live GitHub state) |

**Author duties.** Put in the PR description: issue link, acceptance criteria, exact head SHA, commands run with results, CI run link, known risks, owner approvals needed. On every push, post a comment with the new head SHA and what changed. Before new work, read all review comments on your PRs (`pull_request_read` `get_reviews`, `get_review_comments`, `get_comments`) and fix findings on the same PR and branch. Reply to each finding as fixed (with SHA), disputed (with evidence) or deferred (with a linked issue and owner approval if scope).

**Reviewer duties.** Review a specific head SHA and state it. Post one of:
- `APPROVE @ <sha>`: acceptance criteria met, tests inspected for the real execution path, no open findings.
- `REQUEST CHANGES @ <sha>`: each finding has file/line, observed vs expected and a suggested test or fix.
- `BLOCKED @ <sha>`: cannot review or cannot approve; state the missing evidence or owner decision.

Every review lists findings as `OPEN`, `RESOLVED @ <sha>` or `WITHDRAWN`. On a new head SHA, review the diff since the last reviewed SHA (`git diff <old>..<new>`) and re-verify only the previously open findings; do not repeat resolved or outdated ones. Green CI is evidence, never approval by itself. Financial, POS, database, security and inventory PRs need review by an agent session other than the author, or the owner. An agent never reviews or approves its own PR. Approval is a recommendation; only the owner merges.

**Owner decisions.** Ask only for genuine scope, business, financial-policy or authorization choices. Put the question in the relevant issue with options, a recommended default and impact, and label it `needs-owner`. Record the owner's answer in that issue as a comment starting `OWNER DECISION:` with date and wording; later sessions reuse it. Never infer or invent approval. While a decision is pending, work on other independent tasks.

## Session Start Routine

Run this at the start of every scheduled or manual session, using GitHub MCP tools or `gh api` (REST):

1. `git fetch origin main`; record the main SHA and its latest CI result.
2. List open PRs and branches. For each PR read reviews, review comments and issue comments, and note the exact SHA each review covers versus the current head.
3. If this session's agent owns a PR with open findings (or a stale head SHA review), address them on that PR before any unrelated work, unless unsafe or blocked on an owner decision (comment why).
4. Otherwise select the highest-priority issue that is `status:ready` + `unattended-ok`, not `needs-owner`/`status:blocked`/`status:in-progress`, with every dependency issue closed **and its PR merged to main** (never stack work on unmerged code), no open PR, and no overlapping files with an open PR.
5. Claim it, implement on a fresh branch from current main, run the checks, open a review-only PR, check CI and fix failures.
6. Record evidence in the PR and issue, then re-query GitHub and go to step 2 for the next eligible issue.

Skip anything awaiting review, merge, owner decision or external validation and take another independent task; a blocked top priority is not a reason to stop. If no eligible issue exists, reconcile the `docs/RELEASE_PLAN.md` matrix and final-freeze checklist against code, open issues and PRs, and open focused issues for untracked agreed work (with priority, area, scope, acceptance criteria, dependencies, files, required tests, unattended-safety and owner decisions; no duplicates) before concluding that development is blocked. Do not manufacture speculative work. Never duplicate a claim or weaken a safety requirement to proceed.

## Agent Completion Reports

Applies equally to Claude Code and OpenAI Codex. Finish every task with one concise, phone-readable report in exactly this format. No logs, no progress narration, no success claims the evidence does not support.

```
FLOWTALLY DEVELOPMENT REPORT
- Status: SUCCESS / BLOCKED / FAILED
- Task: GitHub issue number and title
- PR: link and commit SHA, or none
- Completed: brief summary of actual changes
- Validation: tests and GitHub CI, each marked passed / failed / pending / not run
- Owner action: exact approval or manual step required, or none
- Next: next dependency-ready issue, or the blocker
```

Use the platform's native completion notification when one exists. Do not install external notification services, and never claim a notification was sent unless the platform confirmed it.

## Handoff

Keep `docs/RELEASE_STATUS.md` concise and verifiable: status, evidence (PR, SHA, CI run), blockers, one NEXT TASK. Put long background in `docs/`, not in this file. `HANDOFF.md` is the legacy landing-page handoff.
