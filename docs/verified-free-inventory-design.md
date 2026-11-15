# Verified-free inventory: provenance foundation (#279 Phase A)

Status: **foundation only** (issue #302). No endpoint, receipt, transfer or UI uses this yet. Full #279 acceptance is **not** claimed; endpoint integration waits for #252 to release `backend/pilot_api.py`.

## Problem
`InventoryItem.average_unit_cost == 0` currently means either "genuinely free" or "cost never known" (legacy imports, unpriced receipts, Square/Clover-created items). Treating every zero as free would let unknown-cost stock move between locations at $0 and understate food cost.

## Design
- **Evidence table** `inventory_cost_verifications` (migration `0029_inventory_cost_verifications`, model `InventoryCostVerification`): one row = "this quantity of this item at this location was explicitly verified as genuinely free", with `evidence_type` (`supplier_free_goods`, `donation`, `promotional_sample`, `other_documented`), a mandatory written `evidence_note`, optional source link (`source_type`/`source_record_id`/`source_line_id`, e.g. a receipt line), `verified_by_user_id`/`verified_at`, `organization_id`/`location_id`/`inventory_item_id`, and a per-organization `idempotency_key`.
- **No blanket flag, no backfill.** `InventoryItem` is unchanged. Every existing zero-cost item stays *unverified* because it has no evidence rows.
- **Batch granularity** (`quantity`, `consumed_quantity`) so mixed stock (some verified free, some unknown, some priced) is representable without a per-item boolean.
- **Revocation / correction:** rows are never deleted. Revoke by setting `revoked_at` + non-empty `revoked_reason` (DB check). Correct by revoking and inserting a new row with `correction_of_id`; a correction cannot go below `consumed_quantity`.
- **Tenant isolation:** forced RLS with `flowtally_has_org_access(organization_id)` (USING and WITH CHECK), same as `inventory_transfers`. A PostgreSQL trigger additionally rejects rows whose item is not in the same organization/location (or whose corrected row is in another organization/item). The trigger runs as the invoker, so a foreign tenant's item is also invisible to it.
- **Pure logic** (`backend/verified_free_cost.py`, no DB): `classify_cost_basis`, `zero_cost_transfer_decision`, `validate_new_verification`, `verification_fingerprint`/`idempotent_outcome`, `validate_revocation`, `validate_correction`.

## Classification
| on hand | average cost | active verified coverage | status |
|---|---|---|---|
| <= 0 | any | any | `no_stock` |
| > 0 | > 0 | any | `priced` (free units mixed into priced stock are already blended into the weighted average; no value is fabricated) |
| > 0 | 0 | none | `unverified_zero` (legacy / unknown) |
| > 0 | 0 | partial | `partially_verified_free` (remainder unknown) |
| > 0 | 0 | >= on hand | `verified_free` |

Coverage is capped at on-hand stock, excludes revoked batches and subtracts consumed quantity.

## Acceptance examples (covered by tests)
- Legacy zero cost with no evidence: `unverified_zero`; zero-cost transfer refused (`unknown_cost_not_verified_free`).
- 10 on hand, 4 verified free, avg 0: `partially_verified_free`; transferring 4 at $0 is allowed, 5 is refused.
- Priced stock (avg $2.50) with verified-free batch: stays `priced`; transfers carry the weighted average, never $0.
- Verifying more than the unverified on-hand quantity, without a note, or with an unknown evidence type: rejected.
- Same idempotency key + same request: `replay`; same key, different request: `conflict`; DB unique constraint enforces it.
- Cross-tenant: tenant B cannot read or write A's evidence, cannot attach evidence to A's item, cannot correct A's evidence (PostgreSQL forced-RLS tests, non-owner runtime role).
- Migration 0029 upgrade, downgrade to 0028 and re-upgrade, RLS enabled and forced, table owned by migrator, table empty after upgrade.

## Future integration contract (parent #279, not in this PR)
1. **Recording evidence:** an authorized endpoint (owner/manager role, same RBAC as receipt/adjustment mutations) validates with `validate_new_verification` inside the same transaction that locks the inventory item row, writes one row (idempotent by `idempotency_key`), and writes an `AuditEvent`. Receipt lines that are genuinely $0 should link via `source_*` so the evidence is traceable to the receipt.
2. **Transfers:** a transfer may carry `unit_cost = 0` only when `zero_cost_transfer_decision(...).verified_free` is true. The endpoint must then increment `consumed_quantity` on the source batches (oldest first, under the item lock) and create matching verified batches at the destination in the same transaction, so verification travels with the stock. Unverified zero-cost stock stays untransferable at $0 (reject or require verification first).
3. **Mixing:** receiving positive-cost stock into `verified_free` stock follows existing weighted-average rules (`backend/costing.py`); this design does not change them. Known pre-existing limitation: when the existing average is 0, a priced receipt replaces the average instead of blending with the free units, so integration should decide whether to count verified-free quantity as $0 value in that blend. That is a costing change and is deliberately **deferred** to #279 (requires `costing.py`/`pilot_api.py`).
4. **Partial receipts (#252):** a receipt line cannot create verification evidence implicitly; evidence is recorded separately and may not exceed the received quantity that actually reached on-hand stock.
5. **Revocation/correction:** use the rules above; reports should show revoked evidence and any stock consumed under it.

## Compatibility
- Migration 0029 only adds a table, indexes, a policy, a function and a trigger. Existing tables and migration 0028 are untouched. `backend/pilot_api.py`, `backend/costing.py` and the #252 receipt path are not modified.
- **Release note:** merging adds migration 0029; Render Production auto-runs Alembic on main, so this needs explicit owner release authorization. No data is written.
