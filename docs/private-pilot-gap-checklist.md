# Flowtally Private Pilot Gap Checklist

Current scope: one restaurant tenant, DB-backed pilot workspace under `/app`, public demo unchanged.

Reconciled 2026-11-05 against main `9d2099c` (issue #225, PR #236). A ticked box means the feature is **merged with automated tests**; it is not Showcase or Production verification (see `docs/RELEASE_STATUS.md`, #169 and #165). An unchecked box stays unchecked until the feature is merged or the owner records an explicit deferral for that item. On 2026-11-05 the owner approved the policy for each remaining item below (all are in the MVP); the approved policy is **not** implementation, so these rows stay unchecked and name the implementation issue and any open PR. Nothing here is silently deferred.

## Milestone 1: Supplier and inventory-item management
- [x] Supplier list, create, and update endpoints
- [x] Inventory item create and update endpoints
- [x] Supplier status / active-state control
- [ ] Supplier archive/delete policy. Owner policy approved (#195, soft archive only, no hard delete); implementation pending: #229 (PR #242 open, `REQUEST CHANGES @ 2e154c1` unresolved)
- [x] Supplier-item mapping management UI. Merged in #204 (`b26913f`; independent review APPROVE @ `0ee12dd`); API and UI are location-scoped and tested on SQLite and PostgreSQL/RLS
- [ ] Bulk import / bulk edit. Owner policy approved (#198: keep and verify CSV/XLSX import, add in-app multi-select bulk edit); import verification in #224 (PR #239 open), bulk edit pending: #234 (blocked on #224 and #229); no bulk-edit UI exists yet

## Milestone 2: Complete invoice workflow
- [x] Draft invoice create and edit
- [x] Receive invoice into inventory
- [x] Duplicate receipt protection
- [ ] Invoice delete / void flow. Owner policy approved (#168: auditable void/correction of a received invoice with compensating movements); implementation pending: #232 (blocked on #231)
- [x] Line-level mapping review UX. Merged in #205 (`0d8ab01`; independent review APPROVE @ `cb6c83d`): explicit per-line inventory suggestion (never auto-applied) and a per-line issue list
- [ ] Draft correction workflow after OCR. Not claimed: drafts are editable and received invoices have a correction endpoint, but no acceptance evidence exists for the post-OCR draft-correction flow and #205 left that path unchanged

## Milestone 3: Inventory ledger and stock controls
- [x] Manual adjustments
- [x] Stock-count sessions
- [x] Reorder plan generation
- [ ] Adjustment reversal workflow. Owner policy approved (#196: append-only, once-only reversal); implementation pending: #231 (blocked on #229 and #230)
- [ ] Transfer between locations. Owner policy approved (#197: atomic paired movements, source weighted-average cost kept); implementation pending: #233 (blocked on #230 and #231)

## Platform checks to keep running
- Backend tests
- Frontend build
- Fresh SQLite migration bootstrap
- Seed idempotence
- Inventory totals vs movement ledger (acceptance suite merged in #201, `5788f28`)
- Negative on-hand policy: owner policy approved (#199: manual operations may not go negative, POS consumption may and is flagged for review); baseline tests pending in #230 (PR #243 open), Daily Close/Reorder visibility pending in #237
