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


## Applied orders that later change (#183)

Once Clover inventory has been applied for an order, a later refund, void, payment
conflict, incomplete read or removed line **never changes stock automatically**. A
refund or void does not prove the food was not made, and Clover's API exposes no
field that establishes non-preparation. The reconciliation result instead carries
`appliedRequiresReview: true`, the `staleApplied` quantities per line/ingredient,
and `refundKind` (`none` / `partial` / `full` / `unknown`) so an operator can decide.

`refundKind` is fail-closed. It is `full` or `partial` only when payments are
complete and equal the order total, refunds never exceed the charge, and no
payment, refund or order carries a tip, tax, surcharge (`additionalCharges`),
cashback, service-charge or discount component (those are recorded by name during
normalization). Anything else, including legacy rows without component data, is
`unknown`.

### Future: automatic restoration (not implemented; needs owner approval)

Restoring stock must be driven by a **server-controlled evidence record**, never by
provider JSON or client input. Proposed design: a table
`clover_line_fulfillment_evidence` keyed to the historical Clover line (so it
survives line removal) with `evidence_type` (`owner_confirmed_not_prepared`,
`kds_status` if a verified Clover field is confirmed), `actor_user_id`,
`recorded_at`, `source` and a note, written only by an authenticated owner endpoint
with CSRF, audit event and RLS. The reconciler would reverse only lines with such
a record plus a definitive `refundKind == "full"` or a cancel, using the existing
idempotent ledger. This needs a migration and an owner decision, so it is out of
scope for #186.
