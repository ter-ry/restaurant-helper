# Release-candidate recording audit

**Audited commit:** `c54e7551caf5d30c8cd071e50f7f51029cfe88cc` (latest `origin/main`)

This review covers the production showcase recording surface only. No Production database, Render setting, Square account, or Square data was changed, and no Production Square write was executed.

## Routes and integrated workflows reviewed

The authenticated recording routes were reviewed in the shared pilot implementation: Dashboard, Purchases/OCR, Inventory and movements, Stock Counts, Reorder Plan, Menu Costing, Square Setup & Sync, Usage / Variance, and Daily Close. The public read-only demo route and legacy local-data demo routes were reviewed separately so their intentionally simulated copy is not confused with the Production showcase.

The repository has coverage for these integrated paths:

- OCR invoice review → purchase receive → inventory movement → cost/menu-cost impact (`test_showcase_invoice_review_receive_updates_inventory_cost`).
- Square catalog/location mapping → finalized order sync → recipe theoretical consumption, refunds/reversals, idempotency, and restaurant-timezone grouping.
- Stock-count completion and usage/variance evidence, including missing-count warnings and movement evidence.
- Dashboard/Reorder status derived from the same backend rules used by the operational API.

This audit added a regression assertion that every configured showcase target maps to the actual reorder status classifier (healthy, low, reorder, or out of stock). The 23-item profile is 16 healthy, 4 low, 2 reorder, and 1 out of stock; no target is merely an `intendedStatus` label disconnected from displayed status logic.

## Recording findings

### Blocker: Square catalog presentation needs an operator decision

The dedicated Square fixture is named **`Flowtally Test Burger · Base`**, and the utility discovers the live catalog price at runtime. The seeded Flowtally menu item is **Harbour Burger** at the current application seed price of CAD 18.00, while the dedicated Square variation has historically been CAD 15.00. This can produce visibly contradictory name/price footage. Before recording, an operator must choose and apply a production-facing Square variation name (for example, `Harbour Burger · Base`) and confirm whether the mapped Flowtally menu price should agree with the live Square price. No automatic mutation is appropriate in this audit.

### After recording

- The local Windows worktree could not run Vite/Playwright or frontend unit tests because the managed environment rejects `realpath` with `EPERM`. The runner has strict port, readiness, commit-identification, and cleanup checks; GitHub CI remains the authoritative browser environment.
- Legacy `/demo` pages contain intentional placeholder/demo wording. The public read-only demo also correctly identifies simulated Square data. Neither is the Production showcase copy and neither was changed.
- A stale explanatory sentence in showcase documentation refers to an earlier simulated-state bug; it is documentation-only and does not affect the application.
- The guarded `showcase-replenish` and Square showcase write commands remain explicit operator actions. They were not run here.

### Ignore for now

Existing lint warnings and dependency audit findings were not introduced by this audit and do not affect the recording routes. They should be handled in their normal maintenance work.

## Test matrix

- Backend suite: **222 passed, 48 skipped, 2 warnings** locally. The skips are PostgreSQL-backed tests unavailable in this environment; they are not counted as passes.
- Showcase inventory/status regression: **6 passed**.
- Python compileall (`backend`, `scripts`): passed.
- Frontend typecheck: passed.
- Frontend lint: passed, 74 warnings, 0 errors.
- Production frontend build: passed.
- Frontend unit tests and Playwright: local execution blocked before test collection by the managed-worktree `EPERM realpath` limitation; GitHub CI is required for the complete browser/security matrix.
- PostgreSQL migration/RLS tests: not locally executable; GitHub's PostgreSQL service job is authoritative.

## Release decision

**NOT RECORDING READY** until the dedicated Square catalog name and price are reconciled and the full GitHub frontend/Playwright/PostgreSQL matrix is green. The application flows and tenant/security checks are covered by the passing backend suite and the added reorder-status regression; the remaining blocker is visible Square catalog coherence plus the required CI/browser evidence, not a code-path failure found in this audit.
