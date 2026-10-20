# Provider-neutral POS foundation

The shared boundary in `backend/pos.py` is deliberately small. It normalizes
provider identity, merchant/location identity, external order and line IDs,
order state, timestamps, catalog variation identity, quantities and refunded
quantities. It also owns the two provider-independent calculations used by
inventory depletion: finalized sale quantity and recipe ingredient quantity.

Square remains the only adapter and continues to own OAuth, API payload
parsing, persistence, webhook/reconciliation, mapping, reporting and audit
behavior. Its existing `SquareOrder*` tables and inventory movement keys are
unchanged; no migration is required.

The shared inventory boundary requires an explicit known provider before
automatic depletion. This prevents a future Clover adapter from silently
sharing Square's inventory source. A later Clover persistence PR must add
provider-specific connection, webhook and idempotency storage and map Clover
statuses conservatively: an order's existence is not proof that payment is
finalized, and unknown or ambiguous states must not deplete inventory.

The next Clover sandbox PR needs only a Clover adapter that produces the value
objects in `backend.pos`, validates its merchant/location mapping, and routes
finalized orders through the same calculation boundary. It must add its own
`X-Clover-Auth` webhook verification and rotating OAuth refresh-token handling;
Square authentication and endpoints are intentionally untouched here.
