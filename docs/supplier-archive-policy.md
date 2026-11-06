# Supplier soft archive policy (#195, #229)

Owner decision (#195): suppliers are archived, never hard-deleted. An archived supplier cannot be used for **new** purchasing, but everything created before the archive stays readable.

## Where the rule is enforced

New or changed supplier references are rejected on every write path. Invoice, inventory-item and import paths return a field validation error (HTTP 400, "is archived. Restore it..."); the supplier-item-mapping endpoints return HTTP 409 (conflict with the supplier's archived state):

| Path | Rule |
|---|---|
| Purchase invoice create / update | New invoice or changed supplier rejected; an existing invoice keeps its supplier and stays editable |
| Inventory item create / update | Assigning an archived supplier rejected; an item already pointing at it stays editable, supplier unchanged |
| Supplier-item mapping create / update | Creating a mapping, re-pointing it to a different inventory item, or changing its supplier item name is rejected (409). An existing mapping stays listable and deletable, and safe edits to it (purchase unit, inventory unit, conversion factor, or resubmitting the same item and name) are allowed |
| CSV/XLSX import: `inventory_item` create and update | Preview blocks the row (`archived_supplier`); execute re-checks, so archiving after approval fails the whole job with nothing written; an unchanged reference on an update is allowed |
| CSV/XLSX import: `supplier_item_mapping` | A **new** mapping for an archived supplier is blocked in preview and execute; updating an already-existing mapping is allowed |

Restoring the supplier re-enables all of the above. Archive and restore are idempotent. Supplier lookups are always scoped to the caller's organization, so another tenant's archived supplier is never consulted and never revealed.

## Decisions recorded for review questions on PR #242

- **Reorder plans are not purchases.** A reorder plan only lists what to order. It creates no invoice and posts no stock. Plan creation therefore snapshots an item's existing supplier as history and flags `supplierArchived` on each suggestion so it is visible, not silent. The rule is enforced where a purchase is actually created: the invoice create/update step.
- **Receiving is preserved.** An invoice created before its supplier was archived can still be viewed, edited and received. That is a historical document, not a new purchase. No existing contract disallows it, so it is intentionally allowed.

Tests: `backend/tests/test_pilot_api.py` (API paths), `backend/tests/test_imports_archived_supplier.py` (import paths), `tests/frontend/PilotSupplierArchive.test.tsx` (UI).
