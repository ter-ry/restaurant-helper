# Clover inventory acceptance runbook (#166), owner-run

Docs only. No agent runs this. Clover inventory writes stay disabled until the owner explicitly executes step 5, and the flag is restored afterwards. Written 2026-11-18 from the code at main `99f232b`.

## Finding: why order `80CM9MTRVQ7C4` is not an eligible sale

Observed in the owner's GET-only checks: order state `OPEN`, `paymentState` `OPEN`, total 1800, one payment `75A57AHVQX6AY` with result `SUCCESS` for 1800, no refunds.

Flowtally's classification (`backend/clover_orders.py`, `classify_order`):

1. The payment is `SUCCESS` and equals the total, but the order itself still says `OPEN`/`OPEN`. That contradiction sets `paymentStateConflict`.
2. In the `OPEN` branch this yields `normalized_status="review"`, `potentially_eligible=False`, `requires_review=True`.
3. Inventory planning (`backend/clover_inventory.py`) returns `eligible: false`, reason `order_not_financially_verified` (or `financial_or_line_data_incomplete`). No `InventoryMovement` is created even with the flag on.
4. This is **expected fail-closed behavior, not a Flowtally defect.** An existing test (`backend/tests/test_clover_orders.py`, payment-level refund expansion) already uses this same payment id and asserts `review`, not eligible, `paymentStateConflict` true.

What it means in Clover terms (inference, not verified against Clover internals): a payment record was attached to the order, for example through the Sandbox dashboard or a direct payment call, but the order was never moved to `PAID`/`CLOSED`. Clover therefore exposes a payment that succeeded without confirming that the order is paid. Flowtally requires both to agree, so it will not treat it as a sale. Correction (2026-11-19, from Clover docs `ordercreatepaymentfororder`): the payments POST on the Platform API logs external tenders for bookkeeping and is not the card-payment flow. The supported ways to get a PAID order are the Ecommerce pay endpoint (`POST https://scl-sandbox.dev.clover.com/v1/orders/{orderId}/pay`, see `create-an-atomic-order` and `postordersidpay`) or a real Sandbox Register/device checkout. Flowtally should not be loosened to accept the payment alone, since that would count unreconciled or external tenders as sales.

**Retrieval window.** `fetch_orders` filters on `modifiedTime`. With no dates the default is the last 7 days, so an October order is outside it today. The fetch endpoint accepts `startDate` and `endDate` up to 90 days apart (maximum 3 pages by default, 5 at most, 50 per page). Even inside the window this order would still classify as `review`, so the window is not the blocker. A fresh paid order avoids the question.

## Preconditions (read-only checks)

1. Environment and deployed SHA/Alembic head recorded on #165, with `CLOVER_ORDER_INVENTORY_ENABLED` currently off. The deployed head must include 0029.
2. Sandbox merchant connected (`connection.status=connected`, `environment=sandbox`). Production is never used.
3. A mapped test item: the Clover line item is mapped to a Flowtally menu item with a recipe, and every ingredient is an active inventory item with a compatible unit.
4. Record on-hand and weighted-average cost for each ingredient (screenshots or exported rows).

## Procedure

1. **Create a genuinely paid order (owner-run, needs separate authorization; see "Supported paid-order procedure" below).** Do not use `POST .../orders/{orderId}/payments` on the Platform API: Clover documents it as an external-tender bookkeeping record, so it can produce exactly the `SUCCESS` payment on an `OPEN`/`OPEN` order that we saw on `80CM9MTRVQ7C4`. Then run the GET-only checks: `paymentState=PAID`, one `SUCCESS` payment equal to the total, refunds 0.
2. **Read-only eligibility in Flowtally.** Call `POST /api/integrations/clover/shadow-orders/fetch` with `{"dryRun": true, "startDate": "<before order>", "endDate": "<now>"}` (no `executeInventory`). This ingests the shadow order only and applies nothing. Expect `status=paid`, `inventoryAutomation.dryRun=true`, a result with `eligible: true`, and a movements list showing recipe quantity times line quantity per ingredient. If `eligible` is false, stop and record the `reason`. Do not proceed.
3. **Expected change.** One negative `InventoryMovement` per ingredient (`source_type="clover sale consumption"`, `source_record_id=<order id>`, `source_line_id="clover:<ledger id>:<n>"`). `current_on_hand` drops by exactly the planned quantities. Weighted-average cost is unchanged by a consumption.
4. **Backup and flag.** Owner records the current flag value and that a rollback path exists.
5. **One authorized execution (Showcase only).** The owner temporarily sets `CLOVER_ORDER_INVENTORY_ENABLED=true` on Showcase, then calls the same fetch with `"executeInventory": true` (JSON boolean; any other value is ignored). Expect `applied: true`. Record the response and the movement rows.
6. **Idempotent replay.** Repeat step 5 once or twice with the same window. Expect no new movements (`state: unchanged`) and no change in on-hand.
7. **Reconciliation.** Per ingredient: opening on-hand minus the sum of the Clover movements equals closing on-hand, and the movement ledger reconciles to on-hand. Confirm the audit event `clover.shadow_orders.ingested` shows `inventoryAutomation: true` for the run.
8. **Optional negative checks (only if the owner wants them).** Re-fetch the original `OPEN`/`SUCCESS` order `80CM9MTRVQ7C4` with the flag on and confirm it stays `review` with zero movements. A refund of the new order would exercise reversal, but it is a Sandbox write and needs its own owner approval.
9. **Restore.** Set `CLOVER_ORDER_INVENTORY_ENABLED` back to its recorded value (off), confirm via the health or config check, and record the final flag value, deployed SHA and movement ids on #166 and #165.

## Smallest owner action

Complete one new Sandbox sale through a supported payment flow (below) so the order itself reaches `paymentState=PAID`, then run steps 2 and 5 to 9 above.

## Supported paid-order procedure (Windows PowerShell, owner-run)

Status: **not executed.** Creating an order and charging a Sandbox card are Clover writes and need the owner's explicit approval in the live session. Never run against production (`api.clover.com`). The old order `80CM9MTRVQ7C4` is never modified, paid, or deleted by this.

**Why this path.** Clover documents the three steps for API-created orders: (1) `POST /v3/merchants/{mId}/atomic_order/checkouts` previews totals and creates nothing; (2) `POST /v3/merchants/{mId}/atomic_order/orders` creates an unpaid order with line items; (3) `POST https://scl-sandbox.dev.clover.com/v1/orders/{orderId}/pay` pays it with a card token. Step 3 requires `User-Agent` and `x-forwarded-for` headers. Its body is `source` (card token) plus optional fields; the schema rejects unlisted fields. Verify the response shows `status=paid` and `amount_due=0`, then confirm on the Platform API that `paymentState=PAID`.

**Credentials (names only; never paste values into GitHub, chat or files).**
- Platform API sandbox token for merchant `V7SXJVSGY5051` (the one used for the GET checks). Used for steps 1, 2 and the verification GETs.
- Ecommerce **public** key (PAKMS) and **private** key for the same sandbox merchant, from the Sandbox dashboard Ecommerce API Tokens page. Public key tokenizes the card; private key authorizes `/pay`. Ecommerce must be enabled on the Sandbox merchant. I could not confirm from the docs whether the Platform token is also accepted by `/pay`; try the private key first. If `/pay` returns 401, stop and record it as the technical blocker.
- A Clover Sandbox **test card** from Clover's test-card documentation. I did not verify a number here; take it from the docs page rather than from memory.

**Preflight (all read-only).**
1. `GET /v3/merchants/V7SXJVSGY5051` returns the Flowtally Test Kitchen merchant.
2. `GET /v3/merchants/V7SXJVSGY5051/items/TE0BYZH7B28AJ` is not hidden or deleted. This is the **catalog item id** Flowtally maps (`clover_menu_mappings.clover_item_id`). The old order's `2J0331CFQ9JPW` is a line-item id, not the item id; the new order's `lineItems[0].item.id` must equal `TE0BYZH7B28AJ`.
3. `GET .../order_types` and pick one order type id for step 2.
4. Run the section 3 SQL (mapping `mapped`, active recipe, ingredient baseline) and #165 evidence first.

**Sequence (PowerShell sketch; secrets read with `Read-Host -AsSecureString`, converted in memory, never echoed).**
1. Preview: POST `atomic_order/checkouts` with `{"orderCart":{"lineItems":[{"item":{"id":"TE0BYZH7B28AJ"}}],"orderType":{"id":"<id>"}}}`. Record the total. Expect 1800 cents plus any merchant tax. If tax or a service charge appears, the total differs from 1800: still pay the exact total; the planner tolerates tax on a first application but `refundKind` will read `unknown` later.
2. Create: same body to `atomic_order/orders`. Expect an order id (`ORD...`), one line item, no payments. Record the id. A second run creates a second order, so run once.
3. Tokenize: POST the test card to Clover's Sandbox token endpoint with the public key (see Clover's card-token docs for the exact host and header). Expect a `clv_...` token. Do not store it.
4. Pay: POST `https://scl-sandbox.dev.clover.com/v1/orders/<orderId>/pay` with `source` = token, headers `Authorization: Bearer <private key>`, `User-Agent`, `x-forwarded-for` (any valid IP of the operator), and `metadata.delete_order_on_failure` set to true so a failed payment does not leave an orphan order. Expect HTTP 200, `status=paid`, `amount_due=0`. Never retry blindly: on a timeout, GET the order's payments first; a retry can double-charge.
5. Verify with the section 2 GET script against the new order id and the new payment id. Required: `paymentState=PAID`, one `SUCCESS` payment equal to total, refund data returned (via `expand=refunds` on the order or payment, not only the merchant refunds filter, which returned HTTP 400 for this merchant), one line with item `TE0BYZH7B28AJ`, no modifications. If `paymentState` is not `PAID`, stop: record the provider response as the blocker. Do not retry with a different endpoint, and do not weaken Flowtally's gate.
6. Cleanup: `Remove-Variable` every key and token variable, close the shell, clear PowerShell history of that session (`Clear-History`; check `(Get-PSReadLineOption).HistorySavePath` for pasted lines), rotate the Ecommerce private key in the Sandbox dashboard if it was ever typed in plain text.

**Alternative if scripting stalls.** Use the Sandbox Register/Test device or Web Register for the same item, with a test card, then run step 5. Same eligibility rules apply.

**Remaining technical blockers (not code defects).** (a) Unverified whether the Platform token can call `/pay`. (b) The Ecommerce keys and test card are owner-held. (c) Atomic order may apply merchant tax, changing the expected total. (d) #165 Render and database evidence is still outstanding.

## Acceptance sequence after a PAID order exists

Authorization gates: **G0** create order and charge test card (Clover write); **G1** shadow flag on plus fetch (writes Flowtally shadow rows); **G2** inventory flag on, dry run; **G3** single execute; **G4** replay; **G5** restore flags off. Each needs its own approval in the live session. Unauthorized steps are read-only only.

1. Baseline (read-only): section 3 SQL, per-ingredient `current_on_hand`, `average_unit_cost`, movement counts, Daily Close and costing figures, hand-computed expected deductions `sale_qty x quantity_required / yield`, quantized to 0.0001.
2. G1: fetch with a narrow window around the new order only, no `executeInventory`. Expect only the new order in `results`. Refetch to prove update, not duplicate.
3. G2: `dryRun:true, executeInventory:true`. The plan must equal the hand computation. No movements written.
4. G3: one execute. Expect one `clover sale consumption` movement per ingredient and cost snapshots equal to average cost.
5. G4: replay twice. Expect zero new movements and unchanged on-hand.
6. Reconciliation: opening minus movements equals closing for each ingredient; Square movements and Square Daily Close unchanged; the Clover usage and costing reports show the order.
7. Negative control: re-fetch `80CM9MTRVQ7C4` with the flag on. It must stay `review` with zero movements.
8. G5: restore both flags to off, screenshot, `/api/health`, and confirm a flag-off fetch is preview-only.

## Further Clover evidence required for the full MVP

Offline tests exist for refund kind decisions, removed applied lines (`test_removed_applied_line_is_flagged_and_stock_never_changes`), deleted/cancelled orders, and unverified refunds (`backend/tests/test_clover_orders.py`, `test_clover_inventory.py`). No provider-level evidence exists. Owner-approved Sandbox writes needed for each, using a second tiny paid order so the acceptance order stays clean:
- **Full refund** of a paid test order, then refetch: expect `appliedRequiresReview`, `refundKind` `full` or `unknown`, stock unchanged (never auto-restored). Correct stock by the existing adjustment flow.
- **Partial refund**: expect `partial` or `unknown`, review, stock unchanged.
- **Void or delete an unpaid test order** before payment: expect `cancelled` or `deleted`, never eligible.
- **Removed line after application**: delete a line from an applied order (an unpaid second order cannot reach this state; use an order already applied) and expect the stale flag, no stock change.
Each is classified: optional for the Nov 22 freeze only if the owner records the offline tests as accepted evidence; otherwise required. That decision belongs to the owner on #166.
