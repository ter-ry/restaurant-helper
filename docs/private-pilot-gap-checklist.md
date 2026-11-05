# Flowtally Private Pilot Gap Checklist

Current scope: one restaurant tenant, DB-backed pilot workspace under `/app`, public demo unchanged.

Reconciled 2026-11-05 against main `c6cee28` (issue #225). A ticked box means the feature is **merged with automated tests**; it is not Showcase or Production verification (see `docs/RELEASE_STATUS.md`, #169 and #165). An unchecked box stays unchecked until the feature is merged or the owner records an explicit deferral for that item; the open decision issue is named beside it. Nothing here is silently deferred.

## Milestone 1: Supplier and inventory-item management
- [x] Supplier list, create, and update endpoints
- [x] Inventory item create and update endpoints
- [x] Supplier status / active-state control
- [ ] Supplier archive/delete policy. Owner decision pending: #195
- [x] Supplier-item mapping management UI. Merged in #204 (`b26913f`; independent review APPROVE @ `0ee12dd`); API and UI are location-scoped and tested on SQLite and PostgreSQL/RLS
- [ ] Bulk import / bulk edit. Owner decision pending: #198. CSV/XLSX import jobs exist in `backend/imports.py` and their coverage is being verified in #224; bulk edit in the UI is not built

## Milestone 2: Complete invoice workflow
- [x] Draft invoice create and edit
- [x] Receive invoice into inventory
- [x] Duplicate receipt protection
- [ ] Invoice delete / void flow. Owner decision pending: #168
- [x] Line-level mapping review UX. Merged in #205 (`0d8ab01`; independent review APPROVE @ `cb6c83d`): explicit per-line inventory suggestion (never auto-applied) and a per-line issue list
- [ ] Draft correction workflow after OCR. Not claimed: drafts are editable and received invoices have a correction endpoint, but no acceptance evidence exists for the post-OCR draft-correction flow and #205 left that path unchanged

## Milestone 3: Inventory ledger and stock controls
- [x] Manual adjustments
- [x] Stock-count sessions
- [x] Reorder plan generation
- [ ] Adjustment reversal workflow. Owner decision pending: #196
- [ ] Transfer between locations. Owner decision pending: #197

## Platform checks to keep running
- Backend tests
- Frontend build
- Fresh SQLite migration bootstrap
- Seed idempotence
- Inventory totals vs movement ledger (acceptance suite merged in #201, `5788f28`)
- Negative on-hand policy: owner decision pending in #199
