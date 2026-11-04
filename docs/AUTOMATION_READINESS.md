# Automation Readiness Evidence

Verified 2026-11-03 from a Claude Code cloud session on `main` at `bb7b761`. Nothing here activates a schedule. Re-verify if the environment changes.

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
| Isolated PostgreSQL 16 | Available: `pg_ctlcluster 16 main start`, create a disposable `flowtally` superuser and `flowtally_test` database, apply `scripts/provision_postgres_roles.sql`, then export the five URLs from `.github/workflows/ci.yml`. Migration, Clover-inventory and 43 RLS tests passed. Requires root in the sandbox. Use only local disposable databases |
| Full `test_postgres_rls.py` | 8 tests fail on clean PostgreSQL 16; CI never runs them (#163). Unconfirmed on GitHub's runner |

## Repository safety state

- `main` is **not protected** (no branch protection, no rulesets). Merge also deploys GitHub Pages. Owner action: #171.
- Repo/issue/label write access works for this connection. PR auto-merge is disabled at repo level (`allow_auto_merge=false`), which is the desired state.
- GraphQL is blocked in cloud sessions; documented in `AGENTS.md`.

## Not tested

Scheduled/unattended permission behavior (no schedule created), Codex sessions, two agents racing to claim one issue (claiming is a label plus comment, not a lock), recovery after a mid-task session end, and any Staging/Production/Sandbox interaction.

## Manual actions before nightly scheduling

1. Protect `main` with a ruleset requiring PRs and the `backend` and `frontend` checks (#171).
2. Fix the Playwright browser in the environment setup script (#172).
3. Let an agent land #163 (RLS test coverage) so a green CI run means full RLS coverage; owner approves its workflow change.
4. Record deployed SHAs/Alembic heads (#165).
5. Run one supervised fresh-session resume test: new session, read `AGENTS.md` and `docs/RELEASE_STATUS.md`, claim one `unattended-ok` issue, open a PR, stop at the merge gate. Repeat once with Codex if it will be used.
6. Decide the schedule, permission mode and per-run limits when creating the scheduled task; none exists yet.
