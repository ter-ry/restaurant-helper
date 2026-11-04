---
name: flowtally-verify
description: Run and record Flowtally backend, PostgreSQL/RLS, frontend and build checks the way CI does. Use before opening or updating a PR, when a test fails, or when asked whether a change is verified or a failure is a regression.
---

# Flowtally verify

Policy lives in `AGENTS.md` (Verification, Engineering Invariants); CI truth is `.github/workflows/ci.yml`. This skill is only the execution recipe. Read CI rather than trusting this file if they disagree.

## 1. Environment (one interpreter, CI parity)

```bash
source .claude/skills/flowtally-verify/scripts/setup-env.sh   # backend + PostgreSQL
npm ci                                                         # frontend, if node_modules is stale
```

The script builds `.venv` (Python 3.12 like CI), so `python` and `pip` are the same interpreter; always use `python -m pip` / `python -m pytest`. It starts local PostgreSQL 16 (root only), provisions disposable roles via `scripts/provision_postgres_roles.sql` and exports the five CI URLs. Never use real or shared databases. If PostgreSQL is unavailable, PG-gated tests skip: say so, never call that "full".

## 2. Iterate with focused tests

- Backend: `python -m pytest backend/tests/test_<area>.py -q -x` (or `-k name`).
- Frontend: `npx vitest run <file>`; `npm run lint`, `npm run typecheck`.
- Migration / RLS touched: also `python -m pytest backend/tests/test_migrations_postgres.py backend/tests/test_postgres_rls.py -q`.

## 3. Before delivery (match CI)

Backend, from `ci.yml`: `git diff --check`; `test_staging_postgres_roles.py`; `test_seed.py::test_migrations_upgrade_and_seed_on_fresh_database`; `test_migrations_postgres.py`; `test_postgres_rls.py` (whole file); then `python -m pytest backend/tests --ignore=backend/tests/test_migrations_postgres.py --ignore=backend/tests/test_postgres_rls.py -q` (~3-4 min; run in background with a timeout); `python -m unittest discover -s tests`.
Frontend: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; `npm run e2e` when UI flows changed (see limits below).
Run only what the change warrants for iteration, but the full suite for the areas CI covers before the final push. Do not rerun identical suites without a code change.

## 4. Failures: diagnose before blaming

1. Read the real traceback; reproduce with the single test.
2. Check whether it fails on current main: `git worktree add ../ft-main origin/main` (after `git fetch origin main`), run the same test there with the same env. Fails on main too means pre-existing: report with evidence and link/open an issue, do not "fix" inside an unrelated PR unless in scope.
3. Passes on main, fails on branch: it is yours; fix the code.
4. Compare with the latest CI result (`gh run list`/`gh run view`, or MCP `get_check_runs`) to separate environment from code.
5. Never skip, xfail, loosen or delete a test, or edit a workflow, to get green.

## 5. Known environment limits

- `npm run e2e` can fail when the Playwright version's expected Chromium revision differs from `/opt/pw-browsers` (issue #172). Confirm by the "executable doesn't exist" error; do not alter the repo. Report e2e as not run/environmental, not passed.
- GraphQL is blocked: use `gh api` or MCP tools.

## 6. Record

Report each command actually run with pass/fail counts and the HEAD SHA (`git rev-parse HEAD`); mark anything not run as `not run` with the reason. Feed this into the PR description and completion report from `AGENTS.md`.
