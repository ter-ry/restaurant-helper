# Flowtally Release Status

Last updated: 2026-11-03 by Claude Code (baseline refreshed after PR #161 merged). Before editing, check that existing rows are still current (`git log`, open PRs, CI); never overwrite another agent's evidence without re-verifying it. Plan: `docs/RELEASE_PLAN.md`.

Status values: Not started - In progress - Implemented but unverified - Automated tests passed - Sandbox/Showcase verified - Production verified - Blocked - Complete.

## NEXT TASK

**Milestone 1: reconcile deployed state.** Highest-priority dependency-ready work:

1. Owner reviews/merges planning PR #162 (merge gate; agents do not merge).
2. Then an independent **read-only review of merged commit `776f557`** (Clover sales-to-inventory reconciliation, merged via #161): confirm flag-off is a no-op, Square untouched, migrations 0025/0026 have forced RLS and tenant/location indexes, idempotency, concurrency, refund/void handling and cost snapshots. Report findings; fix only via a new focused PR.
3. Then **deployment/migration verification**: owner confirms which environments run `776f557` and their Alembic head (0026 expected only where deployed), and that `CLOVER_ORDER_INVENTORY_ENABLED` is `false` everywhere except any deliberately enabled Showcase.
4. Owner fills the "Owner actions" table (deployed SHAs/heads, Clover-first-customer decision).

Do not start new feature work until step 1 is merged. Do not enable Clover inventory automation without owner approval.

## Baseline

| Item | Value | Evidence |
|---|---|---|
| `main` | `ccaac01d8468e1274d0d274dde4ba74faae88a0a` (PR #160 merge) | git |
| CI on `main` | success | [run 41477196327](https://github.com/ter-ry/restaurant-helper/actions/runs/41477196327) |
| Pages deploy on `main` | success | [run 41477196974](https://github.com/ter-ry/restaurant-helper/actions/runs/41477196974) |
| `main` after #161 | `776f557ed482b9a1851425a5d0d810650c0df7cf` (PR #161 merged) | git; Pages deploy [run 41553204916](https://github.com/ter-ry/restaurant-helper/actions/runs/41553204916) success; CI [run 41553204802](https://github.com/ter-ry/restaurant-helper/actions/runs/41553204802) success |
| Latest Alembic migration in repo | `0026_clover_consumption_cost_snapshot` (0025/0026 present on `main`) | `backend/migrations/versions`. **Not claimed applied to any environment**: no deployment evidence yet |
| Open PRs | #162 (this planning PR) only | GitHub |

## Milestones

| # | Milestone | Priority | Status | Evidence / note |
|---|---|---|---|---|
| 1 | Reconcile repo, PRs, deployed state | P0 | In progress | Repo/PR baseline done here; deployed SHAs/heads unknown (owner) |
| 2 | Purchasing and inventory | P0 | Automated tests passed (as of 2026-10-26 audit; not re-run here) | `docs/pilot-end-to-end-readiness.md`, run 40341272838; invoice void/correction not implemented |
| 3a | Square integration + Daily Close | P0 | Sandbox/Showcase verified (2026-10-07 audit; not re-verified) | `docs/release-candidate-recording-audit.md` |
| 3b | Clover integration | P1 (P0 only if owner says) | Implemented but unverified | #161 merged to `main` at `776f557`, flag default off; needs independent review and controlled Sandbox validation |
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
| Clover sales to inventory | Implemented but unverified | Merged in #161 (`776f557`) behind `CLOVER_ORDER_INVENTORY_ENABLED=false` (default and staging example). CI-tested only. Needs independent review and controlled Sandbox validation before any enablement |
| Multi-tenant RLS | Automated tests passed | Independent review not yet done |

## Pull requests

| PR | Branch | Status | Evidence | Rule |
|---|---|---|---|---|
| [#161](https://github.com/ter-ry/restaurant-helper/pull/161) Guarded Clover sales-to-inventory reconciliation | `codex/clover-sales-inventory` | **Merged** to `main` as `776f557`. Pre-merge checks green ([run 41523502053](https://github.com/ter-ry/restaurant-helper/actions/runs/41523502053)) | CI only; no independent review; no flag-on Sandbox rehearsal recorded | Closed work. Do not rewrite; follow-ups go in new focused PRs. |
| [#162](https://github.com/ter-ry/restaurant-helper/pull/162) Planning docs (this PR) | `claude/nice-brown-94okjr` | Review-only | Docs only | Owner merge |

## Known technical blockers

1. Clover flag-on path (merged, disabled) has no independent review and no Sandbox/Showcase evidence (needs a paid Sandbox order; external prerequisite).
2. Clover is absent from Daily Close, reporting, menu costing and costing.
3. Invoice void/correction after receipt and several gap-checklist items are unimplemented (`docs/private-pilot-gap-checklist.md`).
4. Existing audit docs are dated (Aug-Oct 2026) and not re-run on current `main`.
5. Production uses a shared Aiven server (documented temporary arrangement).

## Owner actions (agents cannot do these)

| Action | Why |
|---|---|
| Merge/approve PR #162 | Merge gate |
| Confirm deployed SHA and Alembic head for Production, Staging, Showcase, Demo | Not visible from the repo |
| Decide whether the first customers use Clover (changes M3b to P0) | Scope |
| Provide a paid Clover Sandbox order for rehearsal | External |
| Confirm whether `776f557`/migrations 0025-0026 are deployed or applied anywhere | Not visible from the repo |
| Decide on invoice void/correction scope for MVP | Scope |
| Pricing, legal/privacy copy, outreach | Business |
| Production release and feature freeze approval | Mandatory approval |
| Note: merging to `main` auto-deploys the GitHub Pages site | Release impact |

## Automation boundaries

Agents can: audit, branch, implement, test, open PRs, read CI, fix their own PR. They cannot without a human or new session: merge, deploy, edit Render/Aiven/DNS/OAuth consoles, touch live data, run external sandbox actions, or resume after a session ends (no scheduler is configured; use `CronCreate` or a new session if the owner wants recurring checks).
