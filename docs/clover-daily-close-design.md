# Design note: Clover in Daily Close and food-cost reporting (#167, step 1)

Status: **direction approved by the owner; decisions below are final. No code is changed by this note.** Implementation (step 2) waits for #186 (reversal/review semantics) to be independently reviewed and merged. Code and PostgreSQL fixture tests may proceed while #166 Sandbox acceptance is pending, but live Clover inventory writes stay off and the integration must not be labelled externally verified before #166.

## Today (verified in code)
- `backend/daily_close.py` reads Square only: `SquareDailySalesSummary` for sales, the Square cash-drawer API for cash, `_build_square_usage_report` (Square order consumption ledger) for ingredient usage. Waste, count corrections and "other adjustments" come from `InventoryMovement`; since #184, `CLOVER_SALE_SOURCE_TYPES` are excluded from "other adjustments".
- `backend/reporting.py` computes sales, menu sales (via `SquareCatalogMapping`) and usage variance from `SquareOrder`/`SquareDailySalesSummary`.
- `menu_costing.py` / `costing.py` are provider-neutral (recipes and weighted-average cost) and need no change for cost itself.
- Clover data available: `CloverShadowOrder` (+ lines), `CloverMenuMapping`, and `CloverShadowOrderLineInventoryConsumption` (applied quantity and `unit_cost_snapshot` per order line and ingredient). Stock-side writes are flag-gated and default off.

## Proposed behavior
1. **Provider selection.** **Exactly one active POS provider per location** (decision 3), to prevent duplicate inventory consumption; enforce at connection time and in `ensure_inventory_source`, with a test that connecting a second provider is rejected. Add a small provider-neutral read interface (`sales_for_day`, `usage_for_range`, `menu_sales`, `exceptions`) with the existing Square code moved behind it **unchanged**; Clover implements the same interface. Daily Close/reporting pick by the location's provider.
2. **Sales (Clover).** Paid, verified orders (`normalized_status == "paid"`, not `requires_review`) whose `source_closed_at` falls in the business day in the location timezone. Report **net sales excluding tax and tips, after relevant discounts and refunds**. If the tax/tip/discount breakdown is unavailable for an order, do not label gross totals as net and do not compute food-cost % from them: show an explicit "net sales unavailable" state. Orders in review/refunded/cancelled are listed as exceptions, never silently counted.
3. **Ingredient usage and cost (Clover).** Read the consumption ledger (`applied_quantity` x `unit_cost_snapshot`), not a recipe recomputation, so Daily Close reconciles exactly to the movement ledger. Food-cost % = ledger usage cost / net sales for the same orders, shown only when net sales is available.
4. **Menu sales.** Group lines through `CloverMenuMapping`; unmapped lines become "needs mapping" exceptions (mirrors Square).
5. **Delivery orders.** Delivery orders present in verified Clover sales data are included in sales, costing and inventory like any other order. Third-party payout reconciliation is out of scope.
6. **Exceptions.** Surface `appliedRequiresReview` orders (#186), unmapped items, missing recipes, and incomplete/conflicted financial data.
7. **Cash reconciliation.** Expected cash = verified Clover cash-tender totals for the day; the user manually enters actual counted cash and the variance is calculated. Where tender data is incomplete, show "Cash reconciliation unavailable" instead of an invented number.
8. **Variance.** Same formula as Square: expected usage vs counted change, with POS consumption/correction movements excluded from unexplained adjustments (already done in #184).

## Acceptance criteria (for step 2)
- Square Daily Close and report JSON are **byte-identical** before/after, proven by golden-output tests on existing Square fixtures.
- Clover day totals, usage cost and food-cost % reconcile to the movement ledger in a PostgreSQL test with the flag on (paid, refunded-without-evidence, voided, removed-line, unmapped, duplicate replay).
- No Clover order is counted in two days; timezone boundary test.
- Net sales excludes tax/tips and reflects discounts/refunds; missing breakdown yields the unavailable state (test both), never a gross figure labelled net.
- Cash: expected = Clover cash tenders, manual counted cash gives variance; incomplete tender data shows unavailable.
- Second active POS provider on a location is rejected; delivery orders included once in sales, costing and inventory.
- RLS/tenant isolation tests for the new queries; UI shows provider label and the unavailable-cash state at 390px.

## Owner decisions (final)
1. Sales basis: net of tax and tips, after discounts/refunds; never silently gross; explicit unavailable state otherwise.
2. Cash: verified Clover cash-tender total = expected cash; manual counted cash entry gives variance; unavailable state if tender data incomplete.
3. One active POS provider per location.
4. Delivery orders in verified Clover sales data are included in sales, costing and inventory; payout reconciliation not required.
