# Import capability matrix (evidence for #198)

Verified against `backend/imports.py` on `main` c6cee28 for issue #224. This documents what the **existing** CSV/XLSX importer does; it adds no feature. UI entry: `/imports` (`DataMigrationPage`). Flow: upload, map columns (or fixed values), preview, approve, execute, rollback. Access: organization owner, setup admin, or active support grant; execute/approve also need an operational organization.

| Capability | Supplier | Inventory item | Supplier-item mapping |
|---|---|---|---|
| Create new records | Yes | Yes | Yes |
| Update existing (matched by trimmed, case-insensitive name) | Yes | Yes (name + location) | Yes (supplier + item + supplier item name) |
| Preview before write, no live-table change | Yes | Yes | Yes |
| Per-row blockers (required, unknown location/supplier/item, negative or non-numeric, factor <= 0) | Yes | Yes | Yes (fixed in #224: `locationName` was unreachable) |
| Rollback (create deleted, update restored) with dependency blockers | Yes | Yes | Yes |
| Tenant scoping of lookups and job access | Verified | Verified | Verified |
| Audit events (upload, mapping, preview, approve, execute, rollback) | Yes | Yes | Yes |

Also supported: `opening_inventory` scope (reuses the inventory-item path; not exercised by new tests). Limits: `.csv`/`.xlsx` only, 10 MB default, first XLSX sheet only, one identical file per organization (SHA-256) until rolled back.

## Defects found and fixed in this PR (existing behavior)

1. **Mapping import could never succeed.** Validation and apply need `locationName`, but the field was not in the mapping field list, so the mapping endpoint rejected it (400) and every row was blocked. Added the field to backend `ENTITY_FIELDS` and frontend `DATA_IMPORT_FIELDS`.
2. **Corrupt or non-XLSX `.xlsx` upload returned a 500.** Now a 400 with a plain message.
3. **Preview status contradicted the counts.** A job with blocked rows showed `READY_FOR_PREVIEW` on first preview because status was set before counts were refreshed. Now `VALIDATION_REQUIRED`. Approve and execute were already refused, so no bad write was possible.

## Gaps that need an owner decision (not changed; related to #198)

These are rule choices, so no code was changed:

- **Duplicate rows inside one file.** Preview shows both as "create"; execute applies them in order, so the last row wins and `appliedRowCount` counts 2 for 1 record. Options: block duplicates in preview (recommended), or keep last-wins and report it as an update.
- **Blank cells on update erase data.** Updating a supplier from a row with empty contact fields clears existing contact name, phone, email and notes. Options: blank means "leave unchanged" (recommended) or "clear".
- **Update overwrites display casing** of the name with the file's casing.
- **Unknown stock unit and invalid email are warnings, not blockers**, and unknown units are still written.
- **Not implemented:** import-time creation of missing suppliers or locations, bulk edit of existing rows from the UI grid, archive/deactivate via import, a downloadable template, multi-sheet XLSX, cell-level errors with line references in the XLSX parser.

## Evidence

`backend/tests/test_imports_acceptance.py` (8 tests) plus the existing `test_imports.py` (4). Without the three fixes, 6 of the 8 new tests fail. They cover mapping create/update/rollback, blocking reasons, status vs counts, malformed uploads, per-row inventory counts, blank XLSX rows, cross-tenant lookups, and cross-tenant job access (403 on read, preview, approve, execute, rollback, list). Tests run on the default SQLite fixture; no scoped query changed, and no Square, Clover or Daily Close file was touched.
