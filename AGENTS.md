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
- Do not touch another agent's open PR or branch (for example Clover PR #161) unless the owner asks.
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

1. Select the highest-priority dependency-ready task from `RELEASE_STATUS.md`.
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

## Handoff

Keep `docs/RELEASE_STATUS.md` concise and verifiable: status, evidence (PR, SHA, CI run), blockers, one NEXT TASK. Put long background in `docs/`, not in this file. `HANDOFF.md` is the legacy landing-page handoff.
