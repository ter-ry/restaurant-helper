# Flowtally Private Pilot Gap Checklist

Current scope: one restaurant tenant, DB-backed pilot workspace under `/app`, public demo unchanged.

Reconciled 2026-11-16 against main `a46bb23` (issue #315; previous reconciliation 2026-11-05, #225). A ticked box means the feature is **merged with automated tests**; it is not Showcase, Sandbox or Production verification (see `docs/RELEASE_STATUS.md`, #169, #166 and #165). Every item the owner approved on 2026-11-05 has since merged; nothing here is silently deferred.

## Milestone 1: Supplier and inventory-item management
- [x] Supplier list, create, and update endpoints
- [x] Inventory item create and update endpoints
- [x] Supplier status / active-state control
- [x] Supplier archive/delete policy. Soft archive only, no hard delete (#195). Merged in #242 (`ac7d7ff`, issue #229): new purchases blocked, Archive/Restore UI
- [x] Supplier-item mapping management UI. Merged in #204 (`b26913f`; independent review APPROVE @ `0ee12dd`); API and UI are location-scoped and tested on SQLite and PostgreSQL/RLS
- [x] Bulk import / bulk edit (#198). CSV/XLSX import verified and fixed in #239 (`b559515`, #224); import re-upload/rollback guarded by the movement ledger in #246 (`07cc036`, #227); in-app multi-select bulk edit in #255 (`53af81c`, #234)

## Milestone 2: Complete invoice workflow
- [x] Draft invoice create and edit
- [x] Receive invoice into inventory
- [x] Duplicate receipt protection
- [x] Invoice void / correction flow (#168). Ledger-safe compensating movements with lineage merged in #265 (`ed6d1db`, #232); duplicate invoice-number PATCH returns a structured 409 (#261)
- [x] Line-level mapping review UX. Merged in #205 (`0d8ab01`; independent review APPROVE @ `cb6c83d`): explicit per-line inventory suggestion (never auto-applied) and a per-line issue list
- [x] Draft correction workflow after OCR. Authenticated OCR invoice draft correction verified by tests in #256 (`e56a16e`, #253); not Showcase-verified

## Milestone 3: Inventory ledger and stock controls
- [x] Manual adjustments
- [x] Stock-count sessions
- [x] Reorder plan generation
- [x] Adjustment reversal workflow (#196). Append-only, once-only reversal merged in #254 (`43661e0`, #231)
- [x] Transfer between locations (#197). Audited paired movements with valuation merged in #277 (`6a6dcbd`)

## Platform checks to keep running
- Backend tests
- Frontend build
- Fresh SQLite migration bootstrap
- Seed idempotence
- Inventory totals vs movement ledger (acceptance suite merged in #201, `5788f28`)
- Negative on-hand policy (#199): baseline tests merged in #243 (`c35802d`, #230); POS-caused negative surfaced in Daily Close, Reorder and Inventory in #250 (`2eee79e`, #237); partial receipts into POS-negative stock allowed in #303 (`aee8bc7`); inventory row locking in all stock writers in #251 (`f7b9f6a`)
- Verified-free stock evidence (record, revoke, correct, shrink on consumption): #304, #308, #313, #314 merged; browser acceptance at 390/768px tracked in #316 (W2)
