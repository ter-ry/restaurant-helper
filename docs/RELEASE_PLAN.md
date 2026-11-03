# Flowtally — Full Agreed MVP Release and Feature-Freeze Plan

**Owner-approved scope decision (2026-11-03):** The finish line is the **complete agreed Flowtally MVP**, not a limited Square-first launch. All previously agreed functions and fixes must be implemented, integrated, and verified before the final feature freeze; **Clover is required**. Payroll and other features **explicitly confirmed by the owner as future-release work** are excluded. An older P1/P2 label or "optional" wording does **not** by itself constitute an owner-approved deferral.

This decision supersedes older Square-first freeze recommendations and contrary priority/optional labels in older documents or issues. It does not override `AGENTS.md` release and security restrictions. Track current evidence and the next tasks in `docs/RELEASE_STATUS.md`. GitHub issues are the executable queue. Reconcile old audit documents against live code and tests rather than assuming their status is current.

**Two distinct milestones:** An earlier Square-only **pilot/sales test** may be undertaken with verified, honest claims; it is **not** the final MVP feature freeze. The final freeze requires all in-scope Clover and other agreed work. No customer-facing Clover claim or inventory enablement until its own acceptance evidence exists.

## Scope contract and exclusions

- **In scope by default:** The agreed product areas and outstanding items in `docs/private-pilot-gap-checklist.md`, the release and Showcase checklists, and user-approved UI changes. Investigate each missing or unchecked item; complete it or record a **specific owner-approved deferral** in `docs/RELEASE_STATUS.md`.
- **Explicitly deferred:** Payroll and any future features subsequently identified and approved by the owner in a recorded exclusions table. Do not silently expand the exclusion list based only on earlier P1/P2 descriptions.
- **Owner decisions, not silent assumptions:** Where scope is ambiguous (e.g. bulk editing, inter-location transfers, invoice void semantics, scheduling depth, negative-stock policy), create a concise decision request but advance unrelated independent work. Never declare final freeze with an unresolved scope decision.
- **P0:** Must be resolved before final freeze. **P1:** Priority/order of development, not permission to leave an agreed feature unfinished. **P2:** Explicit future-release work *only if owner-confirmed*; otherwise a pending scope decision.
- A new, speculative feature is **not** added merely because an agent thinks it might be useful. Focus on agreed scope and reproducible defects.

## Required completion matrix

Every row below needs implementation, applicable automated tests, integration/Showcase evidence, linked issue/PR, and final status **Verified** or **Owner-approved deferred**. "Code exists" or "CI passed" alone is insufficient. Maintain actual per-row evidence in `docs/RELEASE_STATUS.md`; do not fabricate verification.

| Area | Required for full freeze | Current gaps / evidence to verify |
|---|---|---|
| Supplier management | Create/edit, status/archive policy, supplier-item mapping, agreed bulk operations | Pilot gap checklist has unchecked archive, mapping UI and bulk import/edit; owner must explicitly defer anything not needed |
| Purchasing and OCR | Accurate quantity/price/line-total capture, review/edit, line mapping, draft corrections, receive-once, invoice void/correction with ledger-safe reversals | Confirm #142/#143 on current main and Showcase; define #168 void/correction semantics; prove quantity arithmetic and retries |
| Inventory | Receipts, movements, counts, adjustments, waste, PAR/reorder, audit and reconciled on-hand/cost | Adjustment reversal and transfer are unchecked in gap checklist; decide exact scope, do not silently drop; no duplicated or unexplained movements |
| Square | OAuth, locations/catalog mapping, real sync, consumption/reversals, webhook/replay idempotency, Daily Close and costing/usage | #169 Showcase walkthrough; parity and existing paths must remain unchanged by Clover |
| Clover | OAuth/catalog/mapping, verified paid sale → inventory, corrections/reversals for refund/void/conflict/removed lines, Daily Close, food-cost reporting, safe enablement | #164 independent review; #182 POS-source variance fix PR; #183 reversal gap; #166 paid Sandbox evidence; #167 Daily Close/costing integration; flag must remain disabled until controlled owner approval |
| Menu/food costing | Accurate ingredients/recipes, weighted-average cost, mapping and POS usage/reporting for both agreed providers | Verify actual outputs rather than only page visibility; no false Clover cost claims |
| Daily Close | Cash/card and delivery where genuinely supported, variance basis/formula, sessions, reports, server persistence, usable layout; POS movements not counted as unexplained adjustments | Verify real calculation sources, corrections and Square/Clover parity; #182 addresses Clover source-type handling |
| Schedule demo | Previously agreed availability/conflict preview; no payroll | Demonstrate agreed scope; avoid implying payroll or unsupported scheduling automation |
| UI/UX | All previously agreed screens and owner-reported workflow defects fixed, usable at mobile 390px/768px, accessible states, correct layouts and labels, no misleading/useless reminders | #170 systematic walkthrough; cover mutations with loading/success/failure, data refresh, duplicate-submit protection; targeted fixes only |
| Security and platform | Authentication, roles, PostgreSQL forced RLS, tenant isolation, transaction safety, migrations, realistic regression/e2e, observable errors | Full RLS file now runs in CI after #179; org select fix #180 merged; independent final validation #175 |
| Deployments and demo | Production/Staging/Showcase/Demo SHAs & Alembic heads reconciled, migration/rollback rehearsed, Square+Clover evidence, reproducible clean demo | #165 environment evidence; #166 controlled Clover validation; #169 Square walkthrough; staging rollback |
| Launch handoff | Accurate website/claims, lead form, demo script, pricing, onboarding and support process | #181 public-claims PR merged; owner #174 pricing/terms; review remaining outreach copy and claims before use |

## Milestones and dependencies

### M1 — Source, environment and issue reconciliation

Record current `main` SHA, CI, open PRs and every environment's deployed SHA, Alembic head, health state and Clover flag. Owner provides read-only Render/Aiven evidence where not accessible to agents (#165). Reconcile issue labels for actually merged/completed work (#142/#143/#164/#171/#172), but require evidence before closure. No unknown migration state at freeze.

### M2 — Purchasing, suppliers and inventory completeness

Finish all missing agreed workflows in the pilot gap checklist. Correct OCR arithmetic, invoice receiving, duplicate protection, invoice void/correction/reversal, stock movements/counts/waste/PAR, supplier mappings and applicable editing/transfer workflows. Ask the owner to decide exact semantics of #168 and any genuinely ambiguous items. Test real mutation paths, idempotency, rollback, weighted-average cost, and ledger-to-on-hand reconciliation.

### M3 — Full Square **and Clover** POS completion

Square must retain its verified behavior. Clover is now **required for final freeze**, not P1 optional: review #164 and fix #182/#183; ensure already-applied refunded/voided/conflicted orders and removed lines are safely handled; implement Clover Daily Close and food-cost reporting (#167), with provider parity and tests. Do not equate a warning-only handling with fully reconciled inventory without an explicit owner decision. Execute #166 controlled paid Clover Sandbox/Showcase acceptance with real merchant eligibility and owner-approved temporary enablement; restore the flag off afterward. No agent may turn on production inventory writes, run unauthorized Sandbox transactions or touch customer data.

### M4 — Agreed UI/UX finish

Walk through purchasing, inventory, Square, Clover, Daily Close, menu costing, onboarding and scheduling/demo. Fix previously requested owner-facing layout/variance/reminder problems and all observed in-scope workflow defects, including mobile responsiveness, data refresh and error feedback. Avoid unrelated redesign and speculative polishing. Use Playwright and focused component tests.

### M5 — Full security, accounting and regression gate

All backend, PostgreSQL/RLS, migration (fresh and from Production head), role/tenant-isolation, POS concurrency/idempotency, reversal/cost reconciliation, frontend lint/typecheck/unit/Playwright/build, secrets and dependency review. No unaccounted xfails/skips on required functionality; deferred support tests must be documented. Independent review for financial, Clover, RLS and migration changes. Evidence recorded against final release-candidate SHA (#175).

### M6 — Final feature-freeze and acceptance

Finish *every* in-scope matrix row; no unresolved required feature gaps, unexplained discrepancies or outstanding owner scope decisions. Show Square and Clover end-to-end in controlled environments. Rehearse Staging deploy/rollback, verify financial math and clean Showcase demo, approve customer onboarding. Prepare an RC SHA/tag proposal; **only owner** authorizes release, deploy and freeze. After freeze, new feature/schema changes require a fresh owner decision; security/data-correctness fixes remain allowed.

### M7 — Marketing handoff

Ready the credible demo, pricing, onboarding, support and claims while implementation continues; move the primary focus to acquisition **after M6 freeze**. Pilot outreach may occur earlier where claims accurately reflect currently verified capability. Payroll, when explicitly deferred, is outside this freeze.

## Final freeze checklist (all items required unless owner explicitly defers them)

- [ ] Full scope matrix reconciled against pilot gaps, previous owner requests, issues and current code. Each row Verified or specifically Owner-approved deferred.
- [ ] Supplier/purchasing/OCR/receipt/void/correction workflows correct, including duplicate/retry and financial ledger effects.
- [ ] Inventory, counts, adjustments, waste, PAR/reorder, costing and applicable transfer/mapping/edit flows correct and reconciled.
- [ ] Square real end-to-end acceptance: OAuth/mapping, sales inventory use, reversals, Daily Close, reports.
- [ ] Clover full agreed end-to-end acceptance: mapping, paid verified sale, inventory consumption, correction/refund/void/removed-line reversal, Daily Close and costing/reporting; approved Sandbox evidence, flag safely restored.
- [ ] All agreed UI/UX and mobile defects fixed; mutation states and accuracy checked, including Daily Close variance and unnecessary UI/reminders.
- [ ] Menu costing and scheduling-demo agreed scope demonstrated; no payroll claim or requirement.
- [ ] No unresolved in-scope bugs, misleading feature claims, or undeclared "P1 can wait" shortcuts.
- [ ] Full RLS/security/migration/regression/Playwright evidence green on frozen RC SHA, with justified exclusions only.
- [ ] Inventory movement ledger, on-hand, weighted-average costs, refunds and Daily Close variance/reports reconcile.
- [ ] Production/Staging/Showcase/Demo deployed SHAs and migration heads documented; Staging deploy/rollback rehearsal complete.
- [ ] Clean reproducible Showcase demo, lead flow, onboarding/support/pricing/terms documented and owner-accepted.
- [ ] Owner explicitly approves feature-complete freeze and production release. No agent automatically merges or deploys.

## Autonomous execution and owner gates

GitHub issues with `status:ready` + `unattended-ok` are the execution queue. At each session and before claiming each new issue, fetch current main, PRs, claims and dependencies. Complete focused test-backed PRs and continue onto independent eligible tasks; **no arbitrary two-PR cap**. Creating new follow-up issues may make them immediately eligible; re-query before declaring all work blocked. Never duplicate branches or work on another agent's claim. Keep checkout and run logs concise, avoid repeated broad audits.

Stop at owner-only gates (merges, deployments, credentials, Sandbox transactions, pricing/legal/scope decisions, final freeze); work on another eligible independent issue instead. Label priorities and issue descriptions should be updated to match this plan in a focused task, not silently worked around. Use the shared phone-readable completion report in `AGENTS.md`.

**Dependency outline:** M1 evidence can run parallel to M2/M3 code work; M2 and M3 can proceed on non-overlapping files, then M4/M5, then M6. M7 prep in parallel, final claims/handoff after M6.
