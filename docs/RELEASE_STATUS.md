# Flowtally Release Status

Last updated: 2026-11-03 by Claude Code (initial baseline). Before editing, check that existing rows are still current (`git log`, open PRs, CI); never overwrite another agent's evidence without re-verifying it. Plan: `docs/RELEASE_PLAN.md`.

Status values: Not started - In progress - Implemented but unverified - Automated tests passed - Sandbox/Showcase verified - Production verified - Blocked - Complete.

## NEXT TASK

**Milestone 1: reconcile deployed state.** Highest-priority dependency-ready work:

1. Owner reviews/merges the planning PR that introduced this file (merge gate; agents do not merge).
2. Then an agent (read-only) reviews Clover PR #161 independently: confirm flag-off no-op, Square untouched, migrations 0025/0026 RLS, idempotency and refund handling; post findings, do not push to its branch.
3. In parallel, owner fills the "Owner actions" table (deployed SHAs/Alembic heads, Clover-first-customer decision).

Do not start new feature work until step 1 is merged.

## Baseline

| Item | Value | Evidence |
|---|---|---|
| `main` | `ccaac01d8468e1274d0d274dde4ba74faae88a0a` (PR #160 merge) | git |
| CI on `main` | success | [run 41477196327](https://github.com/ter-ry/restaurant-helper/actions/runs/41477196327) |
| Pages deploy on `main` | success | [run 41477196974](https://github.com/ter-ry/restaurant-helper/actions/runs/41477196974) |
| Latest Alembic migration in repo | `0024_clover_shadow_orders` (0025/0026 only in PR #161) | `backend/migrations/versions` |
| Open PRs | #161 only | GitHub |

## Milestones

| # | Milestone | Priority | Status | Evidence / note |
|---|---|---|---|---|
| 1 | Reconcile repo, PRs, deployed state | P0 | In progress | Repo/PR baseline done here; deployed SHAs/heads unknown (owner) |
| 2 | Purchasing and inventory | P0 | Automated tests passed (as of 2026-10-26 audit; not re-run here) | `docs/pilot-end-to-end-readiness.md`, run 40341272838; invoice void/correction not implemented |
| 3a | Square integration + Daily Close | P0 | Sandbox/Showcase verified (2026-10-07 audit; not re-verified) | `docs/release-candidate-recording-audit.md` |
| 3b | Clover integration | P1 (P0 only if owner says) | In progress | See PR table |
| 4 | UI/UX improvements | P1 | Not started | No walkthrough defect list yet |
| 5 | Regression/security/isolation/migration/e2e | P0 | Automated tests passed on `main` CI only | Needs RC SHA run, independent review |
| 6 | RC and feature freeze | P0 | Not started | Needs owner approval |
| 7 | Demo/onboarding/website/pricing | P0 minimum | In progress | Docs exist (`docs/official-sales-demo.md`, `pilot-onboarding.md`); pricing undecided |

## Feature confidence (do not equate code or CI with commercial readiness)

| Feature | Status | Notes |
|---|---|---|
| Purchasing / invoice receive | Automated tests passed; Showcase verified Oct 2026 | Void/correction after receive missing |
| Inventory ledger, counts, adjustments | Automated tests passed | Transfers, adjustment reversal missing |
| Square sync to inventory | Automated tests passed (PostgreSQL); Showcase verified Oct 2026 | Production merchant use unverified |
| Menu costing | Implemented but unverified | No dedicated acceptance evidence collected here |
| Daily Close | Implemented but unverified | Square-only; no Clover code paths |
| Clover OAuth, catalog, mapping, shadow orders | Sandbox verified per docs; merged | Read-only, no inventory effect |
| Clover sales to inventory | Implemented but unverified | PR #161, flag default off |
| Multi-tenant RLS | Automated tests passed | Independent review not yet done |

## Pull requests

| PR | Branch | Status | Evidence | Rule |
|---|---|---|---|---|
| [#161](https://github.com/ter-ry/restaurant-helper/pull/161) Guarded Clover sales-to-inventory reconciliation | `codex/clover-sales-inventory` @ `1faa548` | Open, not draft; backend and frontend checks green ([run 41523502053](https://github.com/ter-ry/restaurant-helper/actions/runs/41523502053)); not merged, not independently reviewed | CI only; no flag-on Sandbox rehearsal recorded | Existing work. Do not duplicate, rebase, push to, or overwrite. Review only. Based on `ccaac01`. |
| [#162](https://github.com/ter-ry/restaurant-helper/pull/162) Planning docs (this PR) | `claude/nice-brown-94okjr` | Review-only | Docs only | Owner merge |

## Known technical blockers

1. Clover flag-on path has no Sandbox/Showcase evidence (needs a paid Sandbox order; external prerequisite).
2. Clover is absent from Daily Close, reporting, menu costing and costing.
3. Invoice void/correction after receipt and several gap-checklist items are unimplemented (`docs/private-pilot-gap-checklist.md`).
4. Existing audit docs are dated (Aug-Oct 2026) and not re-run on current `main`.
5. Production uses a shared Aiven server (documented temporary arrangement).

## Owner actions (agents cannot do these)

| Action | Why |
|---|---|
| Merge/approve PRs, including this one and #161 | Merge gate |
| Confirm deployed SHA and Alembic head for Production, Staging, Showcase, Demo | Not visible from the repo |
| Decide whether the first customers use Clover (changes M3b to P0) | Scope |
| Provide a paid Clover Sandbox order for rehearsal | External |
| Decide on invoice void/correction scope for MVP | Scope |
| Pricing, legal/privacy copy, outreach | Business |
| Production release and feature freeze approval | Mandatory approval |
| Note: merging to `main` auto-deploys the GitHub Pages site | Release impact |

## Automation boundaries

Agents can: audit, branch, implement, test, open PRs, read CI, fix their own PR. They cannot without a human or new session: merge, deploy, edit Render/Aiven/DNS/OAuth consoles, touch live data, run external sandbox actions, or resume after a session ends (no scheduler is configured; use `CronCreate` or a new session if the owner wants recurring checks).
