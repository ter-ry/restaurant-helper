# Flowtally Private Pilot Gap Checklist

Current scope: one restaurant tenant, DB-backed pilot workspace under `/app`, public demo unchanged.

## Milestone 1: Supplier and inventory-item management
- [x] Supplier list, create, and update endpoints
- [x] Inventory item create and update endpoints
- [x] Supplier status / active-state control
- [ ] Supplier archive/delete policy
- [ ] Supplier-item mapping management UI
- [ ] Bulk import / bulk edit

## Milestone 2: Complete invoice workflow
- [x] Draft invoice create and edit
- [x] Receive invoice into inventory
- [x] Duplicate receipt protection
- [ ] Invoice delete / void flow
- [ ] Line-level mapping review UX
- [ ] Draft correction workflow after OCR

## Milestone 3: Inventory ledger and stock controls
- [x] Manual adjustments
- [x] Stock-count sessions
- [x] Reorder plan generation
- [ ] Adjustment reversal workflow
- [ ] Transfer between locations

## Platform checks to keep running
- Backend tests
- Frontend build
- Fresh SQLite migration bootstrap
- Seed idempotence
- Inventory totals vs movement ledger

