# Clover inventory acceptance runbook (#166), owner-run

Docs only. No agent runs this. Clover inventory writes stay disabled until the owner explicitly executes step 5, and the flag is restored afterwards. Written 2026-11-18 from the code at main `99f232b`.

## Finding: why order `80CM9MTRVQ7C4` is not an eligible sale

Observed in the owner's GET-only checks: order state `OPEN`, `paymentState` `OPEN`, total 1800, one payment `75A57AHVQX6AY` with result `SUCCESS` for 1800, no refunds.

Flowtally's classification (`backend/clover_orders.py`, `classify_order`):

1. The payment is `SUCCESS` and equals the total, but the order itself still says `OPEN`/`OPEN`. That contradiction sets `paymentStateConflict`.
2. In the `OPEN` branch this yields `normalized_status="review"`, `potentially_eligible=False`, `requires_review=True`.
3. Inventory planning (`backend/clover_inventory.py`) returns `eligible: false`, reason `order_not_financially_verified` (or `financial_or_line_data_incomplete`). No `InventoryMovement` is created even with the flag on.
4. This is **expected fail-closed behavior, not a Flowtally defect.** An existing test (`backend/tests/test_clover_orders.py`, payment-level refund expansion) already uses this same payment id and asserts `review`, not eligible, `paymentStateConflict` true.

What it means in Clover terms (inference, not verified against Clover internals): a payment record was attached to the order, for example through the Sandbox dashboard or a direct payment call, but the order was never moved to `PAID`/`CLOSED`. Clover therefore exposes a payment that succeeded without confirming that the order is paid. Flowtally requires both to agree, so it will not treat it as a sale. This is a Sandbox transaction prerequisite: the test order must be completed through a normal Clover checkout (for example the Sandbox Register/Test device flow) so Clover itself sets `paymentState=PAID`. Flowtally should not be loosened to accept the payment alone, since that would count unreconciled or external tenders as sales.

**Retrieval window.** `fetch_orders` filters on `modifiedTime`. With no dates the default is the last 7 days, so an October order is outside it today. The fetch endpoint accepts `startDate` and `endDate` up to 90 days apart (maximum 3 pages by default, 5 at most, 50 per page). Even inside the window this order would still classify as `review`, so the window is not the blocker. A fresh paid order avoids the question.

## Preconditions (read-only checks)

1. Environment and deployed SHA/Alembic head recorded on #165, with `CLOVER_ORDER_INVENTORY_ENABLED` currently off. The deployed head must include 0029.
2. Sandbox merchant connected (`connection.status=connected`, `environment=sandbox`). Production is never used.
3. A mapped test item: the Clover line item is mapped to a Flowtally menu item with a recipe, and every ingredient is an active inventory item with a compatible unit.
4. Record on-hand and weighted-average cost for each ingredient (screenshots or exported rows).

## Procedure

1. **Create the order properly (Clover side, owner only).** Ring up one mapped item with no tip, tax component, discount or service charge (the planner treats those as unverified). Pay it through the normal Clover payment flow. Then run GET-only checks: order `state` is `LOCKED` or `PAID`/`CLOSED`, `paymentState=PAID`, one `SUCCESS` payment equal to the total, refunds 0.
2. **Read-only eligibility in Flowtally.** Call `POST /api/integrations/clover/shadow-orders/fetch` with `{"dryRun": true, "startDate": "<before order>", "endDate": "<now>"}` (no `executeInventory`). This ingests the shadow order only and applies nothing. Expect `status=paid`, `inventoryAutomation.dryRun=true`, a result with `eligible: true`, and a movements list showing recipe quantity times line quantity per ingredient. If `eligible` is false, stop and record the `reason`. Do not proceed.
3. **Expected change.** One negative `InventoryMovement` per ingredient (`source_type="clover sale consumption"`, `source_record_id=<order id>`, `source_line_id="clover:<ledger id>:<n>"`). `current_on_hand` drops by exactly the planned quantities. Weighted-average cost is unchanged by a consumption.
4. **Backup and flag.** Owner records the current flag value and that a rollback path exists.
5. **One authorized execution (Showcase only).** The owner temporarily sets `CLOVER_ORDER_INVENTORY_ENABLED=true` on Showcase, then calls the same fetch with `"executeInventory": true` (JSON boolean; any other value is ignored). Expect `applied: true`. Record the response and the movement rows.
6. **Idempotent replay.** Repeat step 5 once or twice with the same window. Expect no new movements (`state: unchanged`) and no change in on-hand.
7. **Reconciliation.** Per ingredient: opening on-hand minus the sum of the Clover movements equals closing on-hand, and the movement ledger reconciles to on-hand. Confirm the audit event `clover.shadow_orders.ingested` shows `inventoryAutomation: true` for the run.
8. **Optional negative checks (only if the owner wants them).** Re-fetch the original `OPEN`/`SUCCESS` order `80CM9MTRVQ7C4` with the flag on and confirm it stays `review` with zero movements. A refund of the new order would exercise reversal, but it is a Sandbox write and needs its own owner approval.
9. **Restore.** Set `CLOVER_ORDER_INVENTORY_ENABLED` back to its recorded value (off), confirm via the health or config check, and record the final flag value, deployed SHA and movement ids on #166 and #165.

## Smallest owner action

Complete one Sandbox sale through Clover's normal checkout so the order itself reaches `paymentState=PAID`, then run steps 2 and 5 to 9 above.
