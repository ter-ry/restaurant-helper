# Automation Readiness Evidence

Verified 2026-11-03 from a Claude Code cloud session on `main` at `bb7b761`. Nothing here activates a schedule. Re-verify if the environment changes.

**Partially re-verified 2026-11-25 on `main` at `398f24a`** (CLAUDE-W1): the PostgreSQL rows, the `main` protection row and the pre-scheduling checklist below were corrected against a first-hand run and read-only API checks. Rows not marked with that date still carry their 2026-11-03 evidence.

## Capability matrix

| # | Capability | Result | Evidence / limit |
|---|---|---|---|
| 1 | Clone/fetch current `main` | Verified | `git fetch`, reset of the session branch to `origin/main` |
| 2 | Read permanent instructions | Verified for Claude | `CLAUDE.md` imports `AGENTS.md`. Codex reading `AGENTS.md` is **untested** here |
| 3 | Select a ready issue | Verified | Queue created: issues #163-#176 plus labelled #142/#143; listing works via `gh api` |
| 4 | Isolated branch | Verified | Platform assigns the session branch (`claude/nice-brown-94okjr` this session); never push to `main` |
| 5 | Meaningful tests | Partly verified | See below |
| 6 | Push branch, open PR | Verified | Required installing the Claude GitHub App; before that every write returned 403. PR #162 opened and CI observed |
| 7 | Observe CI | Verified | `gh run list/view` and MCP `get_check_runs` work; GraphQL does not |
| 8 | Resume in a fresh session from status/backlog | **Untested** | Files and issues exist; no second session has resumed from them yet |

## Test capability (cloud session, no secrets)

| Check | Result |
|---|---|
| `npm ci`, `npm run lint` (0 errors, 89 warnings), `npm run typecheck`, `npm test` (189 passed), `npm run build` | Verified, all pass |
| `npm run e2e` | **Fails in this environment**: Playwright 1.62.1 expects Chromium r1234, `/opt/pw-browsers` has r1243 (#172). Not a repo defect |
| Backend suite without PostgreSQL (`pytest backend/tests`, venv from `backend/requirements.txt` + `requirements.txt`) | 363 passed, 55 skipped (PostgreSQL-gated), about 3.3 minutes |
| Isolated PostgreSQL 16 | Available. Re-verified 2026-11-25 on `398f24a`; see the recipe below. Requires root in the sandbox. Use only local disposable databases |
| Full `test_postgres_rls.py` | **Corrected 2026-11-25.** The earlier "8 tests fail; CI never runs them" is no longer true: #163 is closed, `.github/workflows/ci.yml` runs the whole file in the `backend` job, and a local run on `398f24a` gave 46 passed, 12 skipped, 0 failed. The 12 skips are the recorded support-access deferral, not failures |

## Repository safety state

- `main` **is** protected. Corrected 2026-11-25: a read-only check lists active branch rulesets `Protect Main` (26415188) and `Protect Develop` (26858821); #171 is closed. Merge still deploys GitHub Pages, so every merge is a release action.
- Repo/issue/label write access works for this connection. PR auto-merge is disabled at repo level (`allow_auto_merge=false`), which is the desired state.
- GraphQL is blocked in cloud sessions; documented in `AGENTS.md`.

## Not tested

Scheduled/unattended permission behavior (no schedule created), Codex sessions, two agents racing to claim one issue (claiming is a label plus comment, not a lock), recovery after a mid-task session end, and any Staging/Production/Sandbox interaction.

## Manual actions before nightly scheduling

1. ~~Protect `main` with a ruleset requiring PRs and the `backend` and `frontend` checks (#171).~~ Done; `Protect Main` is active and #171 is closed.
2. Fix the Playwright browser in the environment setup script (#172).
3. ~~Let an agent land #163 (RLS test coverage) so a green CI run means full RLS coverage.~~ Done; #163 is closed and CI runs the full `test_postgres_rls.py`.
4. Record deployed SHAs/Alembic heads (#165). **Still open — owner action, no evidence recorded.**

## Disposable PostgreSQL recipe (verified 2026-11-25 on `398f24a`)

`pg_ctlcluster 16 main start` is not available in the current cloud image; the server binaries are, so initialise a throwaway cluster directly. Local disposable databases only — never a live service.

```bash
PGD=/var/lib/postgresql/ft_test          # postgres must be able to traverse the path
mkdir -p $PGD && chown postgres:postgres $PGD && chmod 700 $PGD
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGD -U flowtally --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGD -l /var/lib/postgresql/ft.log \
  -o '-p 5432 -c listen_addresses=127.0.0.1' start -w -t 60"

export PGPASSWORD=flowtally
psql -h 127.0.0.1 -U flowtally -d postgres -c "create database flowtally_test"
psql -v ON_ERROR_STOP=1 -f scripts/provision_postgres_roles.sql -h 127.0.0.1 -U flowtally -d flowtally_test
```

Then export the five `FLOWTALLY_TEST_POSTGRES_*` / `DATABASE_URL` values from the `backend` job in `.github/workflows/ci.yml`, pointing at `127.0.0.1:5432`. Install the Python dependencies into a virtualenv (the system Python refuses `pip install` over Debian-managed packages).
5. Run one supervised fresh-session resume test: new session, read `AGENTS.md` and `docs/RELEASE_STATUS.md`, claim one `unattended-ok` issue, open a PR, stop at the merge gate. Repeat once with Codex if it will be used.
6. Decide the schedule, permission mode and per-run limits when creating the scheduled task; none exists yet.
