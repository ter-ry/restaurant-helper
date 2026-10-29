# Clover Sandbox shadow orders

Clover shadow-order ingestion is a disabled-by-default, read-only diagnostic
foundation. It stores normalized Clover orders and line items separately from
Square tables and never creates inventory movements, recipe consumption rows,
Daily Close changes, or Square records.

## Enable only for the Showcase

Set `CLOVER_ORDER_SHADOW_ENABLED=true` for the isolated Flowtally Showcase
runtime after the migration is deployed. The existing Clover sandbox,
organization allowlist, merchant/location mapping, OAuth token refresh and
owner/setup-admin authorization remain required.

## Manual rehearsal

1. Deploy the review commit and apply migration `0024_clover_shadow_orders`.
2. Enable the feature flag only for the Showcase organization/runtime.
3. Create one authorized Test Burger order in Clover Sandbox.
4. In the Clover section, click **Fetch recent orders**.
5. Confirm the order ID, provider status, quantity, merchant scope and
   Test Burger → Harbour Burger mapping.
6. Confirm the recipe preview lists quantities from the saved recipe and the
   panel says **Preview only — inventory unchanged**.
7. Fetch again and confirm the same order and line IDs are updated, not
   duplicated.
8. Verify inventory on-hand values, inventory movements, costing, Daily Close
   and Square data are unchanged.

If Clover cannot produce a paid sandbox order, record that as an external
sandbox prerequisite; do not fabricate a successful live-ingestion result.

The reader uses Clover's documented GET order collection with expanded
payments, line items, modifications, discounts and refunds. Retrieval is
bounded and an incomplete page is rejected rather than saved. Provider status,
normalized eligibility and review-required state are retained independently.
Unmapped items, missing recipes and unsupported/ambiguous provider states remain
visible for review.

Before any later inventory-deduction phase, Flowtally will need explicit
provider-state reconciliation, mapping validation, duplicate protection,
refund/void handling, and a separate authorization decision. A shadow order
alone never authorizes stock changes.


## Clover Sandbox retrieval compatibility

Order-list retrieval requests only the supported `lineItems` expansion. The
reader then performs bounded GET-only requests for line items, payments, and
refunds per order. Restricted payment/refund endpoints are retained as
review-required incomplete orders; they are never treated as paid or eligible
for inventory use. Discounts are intentionally not requested for this
preview-only phase.

Clover fixed-price lines that omit both `quantity` and `unitQty` are treated
as one item. Explicit `unitQty` is used when present; conflicting or invalid
quantity fields require review.
