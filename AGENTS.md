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

- Run `npm.cmd run build` before finishing.
- Run the backend test suite and migration checks whenever backend code changes.
- Manually check the relevant routes for any UI or workflow changes.
- Summarize files changed, what changed, build result, and any remaining limitations.

## Git Rules

- Commit changes after a successful build.
- Push to `origin/main` unless the task specifically asks for a PR branch.
