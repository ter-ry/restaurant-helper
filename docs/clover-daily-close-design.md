# Design note: Clover in Daily Close and food-cost reporting (#167, step 1)

Status: **proposal for owner approval. No code is changed by this note.** Implementation (step 2) waits for owner approval, #186 (reversal/review semantics) merged, and #166 acceptance evidence.

## Today (verified in code)
- `backend/daily_close.py` reads Square only: `SquareDailySalesSummary` for sales, the Square cash-drawer API for cash, `_build_square_usage_report` (Square order consumption ledger) for ingredient usage. Waste, count corrections and "other adjustments" come from `InventoryMovement`; since #184, `CLOVER_SALE_SOURCE_TYPES` are excluded from "other adjustments".
- `backend/reporting.py` computes sales, menu sales (via `SquareCatalogMapping`) and usage variance from `SquareOrder`/`SquareDailySalesSummary`.
- `menu_costing.py` / `costing.py` are provider-neutral (recipes and weighted-average cost) and need no change for cost itself.
- Clover data available: `CloverShadowOrder` (+ lines), `CloverMenuMapping`, and `CloverShadowOrderLineInventoryConsumption` (applied quantity and `unit_cost_snapshot` per order line and ingredient). Stock-side writes are flag-gated and default off.

## Proposed behavior
1. **Provider selection.** One POS provider per location (as enforced by `ensure_inventory_source`). Add a small provider-neutral read interface (`sales_for_day`, `usage_for_range`, `menu_sales`, `exceptions`) with the existing Square code moved behind it **unchanged**; Clover implements the same interface. Daily Close/reporting pick by the location's provider.
2. **Sales (Clover).** Paid, verified orders (`normalized_status == "paid"`, not `requires_review`) whose `source_closed_at` falls in the business day in the location timezone; sum `total_cents`. Orders in review/refunded/cancelled are listed as exceptions, never silently counted.
3. **Ingredient usage and cost (Clover).** Read the consumption ledger (`applied_quantity` x `unit_cost_snapshot`), not a recipe recomputation, so Daily Close reconciles exactly to the movement ledger. Food-cost % = ledger usage cost / net sales for the same orders.
4. **Menu sales.** Group lines through `CloverMenuMapping`; unmapped lines become "needs mapping" exceptions (mirrors Square).
5. **Exceptions.** Surface `appliedRequiresReview` orders (#186), unmapped items, missing recipes, and incomplete/conflicted financial data.
6. **Cash reconciliation.** Square uses cash-drawer shifts. Clover has no equivalent in the data we ingest, so show "Cash reconciliation unavailable for Clover" with the cash-tender total from payments if present; do not invent expected-cash values.
7. **Variance.** Same formula as Square: expected usage vs counted change, with POS consumption/correction movements excluded from unexplained adjustments (already done in #184).

## Acceptance criteria (for step 2)
- Square Daily Close and report JSON are **byte-identical** before/after, proven by golden-output tests on existing Square fixtures.
- Clover day totals, usage cost and food-cost % reconcile to the movement ledger in a PostgreSQL test with the flag on (paid, refunded-without-evidence, voided, removed-line, unmapped, duplicate replay).
- No Clover order is counted in two days; timezone boundary test.
- RLS/tenant isolation tests for the new queries; UI shows provider label and the unavailable-cash state at 390px.

## Owner decisions needed
1. Sales basis: does Clover `total` include tax and tips? Proposed: report net sales excluding tax/tips if Clover exposes them, otherwise label the figure "total incl. tax/tips".
2. Cash reconciliation for Clover: accept "unavailable" for the freeze, or require cash-event ingestion?
3. Can one location ever have both providers (proposed: no)?
4. Delivery/third-party orders: out of scope unless named.
