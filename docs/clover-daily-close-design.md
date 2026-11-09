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

## Implementation status (#222, slice 4)
Implemented in `backend/clover_daily_close.py` (builder) with a provider switch in `backend/daily_close.py`. A location uses the Clover path only when Clover is its sole active provider; every other location keeps the unchanged Square path (guarded by `backend/tests/test_daily_close_square_golden.py`, generated from `main` before this change). Daily Close UI shows the provider, exact or "Unavailable" figures and cash variance.

Known limits, all fail-closed (never zero or invented):
- **Usage cost / food-cost %** are read from the real engine's ledger (fixed in #240/#247) and verified end to end through Daily Close: $2.75 / 27.5% for the reference order, $3.00 / 30% after a recipe correction, replay-safe, with historical cost snapshots. They stay unavailable (never partial) for any day with a missing/malformed recipe, unmapped item or unapplied sale.
- **Expected cash** is unavailable whenever any day order lacks a tender identifier or is excluded for review (refund, incomplete evidence); the order fetch does not yet request tender detail, so expect "unavailable" until it does.
- **Physical-count usage variance** for Clover is not provided (actual usage and variance stay unavailable).
- The completed-close CSV is unchanged and Square-sourced; it has no provider column so the Square export stays byte-identical.
- **Owner Reports (#262, owner-approved Option B).** For a Clover-only location `backend/reporting.py` delegates to `backend/clover_reporting.py`, which calls `clover_sales_for_day` and `clover_usage_for_day` once per business day and aggregates them, so Reports and Daily Close cannot disagree. Square locations take the unchanged Square path. Response is marked `provider: "clover"`, `sales.source: "clover_orders"` and `sales.status` of `available`, `partial` or `unavailable`:
  - `unavailable`: no verified paid order is stored for the window (or only cancelled/unpaid ones), a paid order lacks a tax breakdown, or the window exceeds 62 days. Money is `null`, never `$0`.
  - `partial`: some orders were excluded (refund, incomplete evidence, needs review). Headline money is `null`; the verified-orders subtotal is exposed as `sales.verified`. Refund amounts stay unavailable (Clover refund tax/tip semantics are unverified, #166); `refundOrderCount` is reported.
  - Gross sales, discounts, cancelled count and per-item revenue are `null` (not authoritative from Clover). Item units, usage cost and food cost % come from the signed consumption ledger and appear only when every day in the window is complete. Physical-count usage variance is not provided for Clover. Weekly comparisons are withheld unless both windows are `available`.
  - Real-Sandbox verification of these figures remains the owner-only gate #166.
- Sales reflect Clover orders already fetched into Flowtally; there is no Daily Close sync for Clover.
- Not externally verified: needs #166 Sandbox evidence. `CLOVER_ORDER_INVENTORY_ENABLED` is unchanged.
- **Multi-quantity lines:** ingestion (`_shadow_recipe_preview`) stores line-total ingredient quantities (sold quantity / recipe yield), so the engine and usage read them as totals and must not multiply again. Verified end to end for quantity 2 (550c / 27.5%, corrected 600c / 30%) and quantity 4 on a yield-2 recipe, plus two tenants under forced RLS.
- **Voids and refunds after stock was applied:** the engine never restocks automatically. A refunded order is excluded from sales and makes usage unavailable; a cancelled order that already used stock now also makes usage unavailable (`cancelled_after_inventory_applied`) instead of reporting a complete, smaller cost.
