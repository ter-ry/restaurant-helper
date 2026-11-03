# Flowtally Release Status

Last updated: 2026-11-03 by Claude Code (issue queue created after PR #162 merged). Before editing, check that existing rows are still current (`git log`, open PRs, CI); never overwrite another agent's evidence without re-verifying it. Plan: `docs/RELEASE_PLAN.md`.

Status values: Not started - In progress - Implemented but unverified - Automated tests passed - Sandbox/Showcase verified - Production verified - Blocked - Complete.

## NEXT TASK

**Work from the GitHub issue queue** (labels: `P0/P1/P2`, `status:ready|in-progress|blocked|review-ready`, `unattended-ok`, `needs-owner`). Pick the highest-priority `status:ready` + `unattended-ok` issue with no open PR or `status:in-progress` claim:

1. **#178 [P0]** Org-selection audit/RLS defect: fix PR open for review. Then **#143 [P0]** (purchases receipt-confirmation modal).
2. **#143 [P0]** Purchases receipt-confirmation modal after OCR receive (existing issue; group with #142 only if one focused PR).
3. **#173 [P0]** Audit public claims against verified features.
4. **#164 [P1]** Independent read-only review of merged `776f557` (owner's preferred sequence starts Clover first; run it in parallel, it is read-only).

Owner-only blockers that gate launch: #165 deployed state, #171 protect `main`, #168 void/correction scope, #169 Square Showcase walkthrough, #174 pricing/terms. Do not enable Clover inventory writes or touch live data.

## Baseline

| Item | Value | Evidence |
|---|---|---|
| `main` | `bb7b761` (PR #162 merged, on top of `776f557`) | git |
| CI on `main` | success | [run 41477196327](https://github.com/ter-ry/restaurant-helper/actions/runs/41477196327) |
| Pages deploy on `main` | success | [run 41477196974](https://github.com/ter-ry/restaurant-helper/actions/runs/41477196974) |
| `main` after #161 | `776f557ed482b9a1851425a5d0d810650c0df7cf` (PR #161 merged) | git; Pages deploy [run 41553204916](https://github.com/ter-ry/restaurant-helper/actions/runs/41553204916) success; CI [run 41553204802](https://github.com/ter-ry/restaurant-helper/actions/runs/41553204802) success |
| Latest Alembic migration in repo | `0026_clover_consumption_cost_snapshot` (0025/0026 present on `main`) | `backend/migrations/versions`. **Not claimed applied to any environment**: no deployment evidence yet |
| Open PRs | none (readiness PR pending) | GitHub |

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
| [#162](https://github.com/ter-ry/restaurant-helper/pull/162) Planning docs | `claude/nice-brown-94okjr` | **Merged** as `bb7b761` | CI green | Closed. |

## Known technical blockers

1. RLS test coverage (#163, merged in #179): the fixture now builds the schema with `alembic upgrade head` and CI runs the whole `test_postgres_rls.py`. The org-selection audit/RLS defect ([#178](https://github.com/ter-ry/restaurant-helper/issues/178)) is fixed in a follow-up PR that also removes the temporary expected failures; until that merges, 3 tests remain expected failures.
2. `main` has no branch protection or ruleset and merging deploys the Pages site (#171).
3. Cloud sandbox cannot run `npm run e2e`: Playwright expects Chromium r1234, r1243 installed (#172).
4. Clover flag-on path (merged, disabled) has no independent review and no Sandbox/Showcase evidence (needs a paid Sandbox order; external prerequisite).
5. Clover is absent from Daily Close, reporting, menu costing and costing.
6. Invoice void/correction after receipt and several gap-checklist items are unimplemented (`docs/private-pilot-gap-checklist.md`).
7. Existing audit docs are dated (Aug-Oct 2026) and not re-run on current `main`.
8. Production uses a shared Aiven server (documented temporary arrangement).

## Owner actions (agents cannot do these)

| Action | Why |
|---|---|
| Merge/approve every PR (merge deploys Pages) | Merge gate |
| Protect `main` with a ruleset (#171) | Repo admin |
| Fix cloud Playwright browser setup (#172) | Environment settings |
| Decide void/correction scope (#168), Square walkthrough (#169), pricing/terms (#174), deployed state (#165) | See issues |
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
