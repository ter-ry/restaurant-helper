# Flowtally Private Pilot Queue

Authoritative execution queue for `codex/overnight-pilot`.

## Milestone 1: Supplier management
- Acceptance criteria: supplier list/search, create/edit, activate/deactivate, normalized duplicate-name protection, contact fields, supplier invoice history, supplier-item mapping visibility, historical-reference protection, owner/manager access, tenant-isolation tests, validation and recoverable errors.
- Current status: COMPLETE
- Commit hashes: 9c8075b
- Verification results: backend tests passed (26/26), frontend build passed, seed idempotence confirmed, supplier isolation and history verified.
- Genuine blockers: none

## Milestone 2: Inventory-item management
- Acceptance criteria: create/edit inventory items, activate/deactivate, search/filters, category, base unit, PAR/minimum quantity, preferred supplier, purchasing conversions, current quantity, estimated value, last purchase price, purchase history, full movement history, protection against unsafe base-unit changes, authorization and tenant-isolation tests.
- Current status: COMPLETE
- Commit hashes: 9114e04, e6fb394
- Verification results: backend tests passed (27/27), frontend build passed; inventory detail/history, conversion fields, base-unit protection, and tenant isolation verified.
- Genuine blockers: none

## Milestone 3: Full stock-count completion
- Acceptance criteria: start/save/resume counts, search/filter lines, zero quantities, progress and uncounted-item display, expected/counted/variance values, later-movement warnings, review before finalization, transactional and idempotent finalization, reconciliation movements, finalized history/details, mobile entry, unsaved-change protection, rollback/concurrency/isolation tests.
- Current status: COMPLETE
- Commit hashes: adb3224, c69864e
- Verification results: frontend build passed after adding count-line search/filter and unsaved-change warnings. Backend suite passed (`27 passed in 31.20s`).
- Genuine blockers: none

## Milestone 4: Full reorder-plan lifecycle
- Acceptance criteria: suggestions from current quantity and PAR, purchasing-unit conversions, preferred-supplier grouping, missing supplier and unknown price states, editable quantities, excluded lines, notes, estimated costs, draft saving/reopening, prepared/completed statuses, historical plan values, previous-plan history, duplicate-submission protection, authorization and isolation tests.
- Current status: COMPLETE
- Commit hashes: c282f1b
- Verification results: backend tests passed (`28 passed in 34.48s`), frontend build passed, reorder-plan isolation verified.
- Genuine blockers: none

## Milestone 5: Permissions and frontend-state audit
- Acceptance criteria: audit every `/api/pilot/*` endpoint and `/app` route for authentication, active users, CSRF, organization membership, location authorization, owner/manager permissions, cross-tenant and cross-location protection, expired sessions, duplicate submissions, loading states, empty states, network/server errors, validation errors, form-value retention, success feedback, mobile usability, accessibility; fix verified issues rather than only documenting them.
- Current status: COMPLETE
- Commit hashes: 72eb2ef
- Verification results: backend tests passed (`28 passed in 28.29s`), frontend build passed, all `/api/pilot/*` routes verified as login-protected in audit coverage, session/network errors now surface in the private workspace shell, dashboard loading state now renders instead of zero-filled metrics.
- Genuine blockers: none

## Milestone 6: End-to-end integration and integrity
- Acceptance criteria: create supplier, create inventory item and conversion, create/map invoice, receive it, verify inventory movements, apply manual adjustment, save/finalize stock count, generate/complete reorder plan, correct completed invoice, verify dashboard updates, verify balances equal movement-ledger totals, verify another organization and location cannot access records; complete fresh migration, seed-idempotence, and public-demo regression checks.
- Current status: COMPLETE
- Commit hashes: 0169b3e
- Verification results: backend tests passed (`30 passed in 16.78s`), frontend build passed, fresh-database migration/seed smoke test passed, end-to-end workflow coverage added for supplier, inventory item, invoice receive/correct, manual adjustment, stock count, reorder plan, dashboard updates, ledger integrity, and tenant isolation.
- Genuine blockers: none
