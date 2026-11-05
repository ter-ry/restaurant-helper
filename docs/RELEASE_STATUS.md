# Flowtally — Full MVP Release Status

Last reconciled 2026-11-04 (backlog reconciliation; main `35f2f51`) for the owner-approved **full agreed MVP feature-freeze**, including **Square and Clover**. Binding scope and final checklist: [RELEASE_PLAN.md](RELEASE_PLAN.md). Do not mistake a green CI build or early Square-only pilot for a completed full freeze.

**Status vocabulary:** Missing / In progress / Implemented but unverified / Automated tests passed / Sandbox or Showcase verified / Complete and verified / Explicit owner-approved deferral / Blocked.

## NEXT TASK — work from GitHub queue

Fresh agents follow the **Session Start Routine** in `AGENTS.md` against live GitHub (this file is a summary and can be stale). No direct push to main, merge, deploy, flag-on Clover, live data or Sandbox transaction without owner approval. Snapshot at 2026-11-04:

- **Open PRs awaiting review/owner (do not touch unless owning):** [#186](https://github.com/ter-ry/restaurant-helper/pull/186) Clover reversal (#183); [#189](https://github.com/ter-ry/restaurant-helper/pull/189) Clover Daily Close design note (#167 step 1, needs owner approval).
- **Ready, independent, unattended-ok:** #142, #143 (Purchases OCR; do together, one PR), #190 supplier-item mapping UI, #192 ledger reconciliation tests, #193 menu costing acceptance tests, #194 schedule conflict preview. #170 is in progress (UI walkthrough).
- **Blocked on a merge:** #191 (needs #142/#143 merged); #167 implementation (needs #189 approval and #166).
- **Owner decisions pending:** #168 invoice void; #195 supplier archive; #196 adjustment reversal; #197 transfers; #198 bulk import/edit; #199 negative stock; #174 pricing/terms. Pilot-gap items stay in scope until each decision or explicit deferral is recorded.
- **Owner/external gates:** #165, #166, #169, #171, #172, #175.
- **Verify-before-close:** #142/#143 reported fixed on main by some agents; confirm against current code first.

**Progression rule:** After every PR/review or new issue, re-query GitHub and continue with another eligible independent task. Stop only at genuine human/permission/session/usage blockers. Never duplicate another agent's work.

## GitHub baseline

| Item | Verified state / limitation |
|---|---|
| Main | `f64db55e71f046e7b9aacfc23e5efdb4c180fefe` (#181 public claims merged; current at reconciliation, refresh before use) |
| CI on main | run [41658619318](https://github.com/ter-ry/restaurant-helper/actions/runs/41658619318) **in progress when checked**; recheck rather than assume passing |
| GitHub Pages | [run 41658619288](https://github.com/ter-ry/restaurant-helper/actions/runs/41658619288) successful on this SHA; not evidence of Render backend deployment |
| Protected main | Active `Protect Main` ruleset observed via GitHub API (issue #171 needs evidence-based cleanup) |
| Open PRs | #186 (Clover reversal), #189 (Clover Daily Close design). #184 (Clover variance fix, #182) is merged. |
| #179 / #180 | Merged; complete PostgreSQL RLS file covered by CI and organization-select audit context defect fixed (34 passed, 12 existing deferred-support skips, 0 xfails on #180) |
| #181 / #173 | Public claims audit merged to `main` as `f64db55`; claims needing owner decisions/outreach cleanup remain |
| #164 Clover read-only review | Completed, [evidence](https://github.com/ter-ry/restaurant-helper/issues/164#issuecomment-6597613125); blockers created as #182 and #183 |
| Latest Alembic in code | `0026_clover_consumption_cost_snapshot`; **deployed database head not independently documented here** |
| Clover execution | Implementation merged in #161, disabled by default, not safe to enable before #182/#183 and controlled #166 acceptance |

## Full-MVP feature matrix — evidence status

A required row cannot be marked Complete without actual integration and acceptance evidence. Refer to RELEASE_PLAN.md for acceptance requirements and owner-only exclusions.

| Area | Status | Remaining action / issue |
|---|---|---|
| Suppliers and purchasing | Implemented, partially verified | #142/#143 Showcase verification; #168 invoice void/correction decision; pilot gap unchecked supplier archive, supplier-item mapping, line review and bulk editing |
| Inventory ledger/counts/waste/PAR | Implemented, partially verified | End-to-end movement/cost reconciliation, adjustment reversal, inter-location transfer scope and gap checklist |
| Square | Automated tests and past Showcase evidence | #169 repeat current-main Showcase acceptance including Daily Close and menu costing |
| Clover catalog/mapping/shadow orders | Sandbox evidence in previous docs | Do not claim production capability; complete all agreed full-MVP flows |
| Clover inventory | Implemented but unsafe to enable | #182/#183; #164 review; #166 paid Sandbox test with owner approval; verify reversals and idempotency |
| Clover Daily Close + food-cost | Implemented but unverified (slice 4 in PR #241, CI green); food cost/usage fail closed until #240; expected cash mostly unavailable until order fetch adds tender detail | #167/#222; **required for final freeze**; needs independent review and #166 |
| Daily Close and variance | Implemented but not fully verified | #182; verify source math, corrections, Square/Clover parity, reports and UI |
| Menu costing | Implemented but not fully verified | Acceptance data and results for both providers |
| Scheduling demo | Implemented demo, not recently verified | Verify availability/conflict preview; payroll explicitly deferred |
| UI/UX | Partial | #170; fix all agreed and observed in-scope defects (desktop/mobile, messages, layouts, variance, unnecessary reminders) |
| RLS and security | Test suite strengthened | Final RC independent review, migration upgrade/rollback, deployment and full e2e #175 |
| Deployments | Owner reports Render has been checked | **Exact per-environment SHA/Alembic/flag/health evidence still needs to be recorded** (#165); do not infer from GitHub Pages |
| Marketing onboarding | In progress | Claims #181 merged; #174 pricing/terms/onboarding/support; accuracy review before outreach |

## Open scope decisions (owner approval required)

- **#168:** invoice void/correction after receipt and ledger-safe reversal semantics. Plan presumes in-scope unless explicitly deferred.
- Supplier archive, supplier-item mapping UI, bulk import/edit, line-level invoice review, adjustment reversal, and inter-location transfers: unchecked pilot gaps. Determine precise previously agreed scope and obtain explicit deferral *per item* if excluded. Do not casually expand the product or silently move these to post-launch.
- Clover #183 reversal policy and cost snapshot on correction (review note S2), negative on-hand handling, and reporting parity where choices affect finance.
- Final pricing, terms/privacy/support channel (#174), controlled Clover Sandbox order/enablement (#166), actual deployment evidence (#165), final release approvals.
- **Explicitly owner-deferred for this freeze:** payroll. Other future-release exclusions: none newly confirmed by this roadmap update. Older P2 labels do not constitute confirmation.

## Safety and freeze blockers

- No owner-approved full-MVP feature freeze while any in-scope feature remains missing, unverified or misrepresented; no silent Square-first freeze.
- No Clover inventory flag-on in Production; do not enable anywhere without separate owner approval and completion of blockers.
- Financial/inventory/RLS PRs require independent review and CI evidence. PR merges and deployments remain owner-only.
- For a final freeze, complete the matrix, all applicable pilot-checklist items, Square/Clover end-to-end tests, full regression/RLS/migrations, Staging rollback rehearsal and reproducible Showcase acceptance; then owner explicitly signs off.

## Coordination and evidence

Agents must claim one GitHub issue per branch/PR, recheck open PRs and claims before starting additional tasks, and avoid duplicate/overlapping changes. Read `AGENTS.md` for owner gates and mobile-friendly completion reports. Add new defects as scoped GitHub issues with acceptance criteria. Do not stop after finding new independently actionable work; do stop when genuine approval or external prerequisites block further safe work.
