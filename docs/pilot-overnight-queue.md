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
- Current status: IN PROGRESS
- Commit hashes: 9114e04
- Verification results: backend tests passed (26/26), frontend build passed; inventory detail/history and base-unit protection wired in.
- Genuine blockers: none

## Milestone 3: Full stock-count completion
- Acceptance criteria: start/save/resume counts, search/filter lines, zero quantities, progress and uncounted-item display, expected/counted/variance values, later-movement warnings, review before finalization, transactional and idempotent finalization, reconciliation movements, finalized history/details, mobile entry, unsaved-change protection, rollback/concurrency/isolation tests.
- Current status: NOT STARTED
- Commit hashes: none yet
- Verification results: none yet
- Genuine blockers: none

## Milestone 4: Full reorder-plan lifecycle
- Acceptance criteria: suggestions from current quantity and PAR, purchasing-unit conversions, preferred-supplier grouping, missing supplier and unknown price states, editable quantities, excluded lines, notes, estimated costs, draft saving/reopening, prepared/completed statuses, historical plan values, previous-plan history, duplicate-submission protection, authorization and isolation tests.
- Current status: NOT STARTED
- Commit hashes: none yet
- Verification results: none yet
- Genuine blockers: none

## Milestone 5: Permissions and frontend-state audit
- Acceptance criteria: audit every `/api/pilot/*` endpoint and `/app` route for authentication, active users, CSRF, organization membership, location authorization, owner/manager permissions, cross-tenant and cross-location protection, expired sessions, duplicate submissions, loading states, empty states, network/server errors, validation errors, form-value retention, success feedback, mobile usability, accessibility; fix verified issues rather than only documenting them.
- Current status: NOT STARTED
- Commit hashes: none yet
- Verification results: none yet
- Genuine blockers: none

## Milestone 6: End-to-end integration and integrity
- Acceptance criteria: create supplier, create inventory item and conversion, create/map invoice, receive it, verify inventory movements, apply manual adjustment, save/finalize stock count, generate/complete reorder plan, correct completed invoice, verify dashboard updates, verify balances equal movement-ledger totals, verify another organization and location cannot access records; complete fresh migration, seed-idempotence, and public-demo regression checks.
- Current status: NOT STARTED
- Commit hashes: none yet
- Verification results: none yet
- Genuine blockers: none
