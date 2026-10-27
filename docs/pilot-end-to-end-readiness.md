# Flowtally End-to-End Workflow Audit and Pilot Readiness

Date: 2026-10-26  
Repository baseline: `main` at `8f7f46a0fa7a6e8f9df859b2cf7095f712d2d8a0`

## Recommendation

**CONDITIONAL GO**

This audit now includes an executable PostgreSQL-backed vertical workflow in the existing GitHub Actions PostgreSQL 16 service. The core purchase receive, weighted-average costing, mapped Square consumption, duplicate replay, and unmapped-item safety assertions pass in the disposable CI database. The recommendation remains conditional because stock-count/Daily Close/dashboard population and external OCR/Square authentication are not part of that isolated test.

## Executed workflow evidence

Test:
`test_postgres_pilot_vertical_workflow_uses_real_receiving_and_square_consumption`

Invocation:
```text
timeout 300s python -u -m pytest backend/tests/test_postgres_rls.py::test_postgres_pilot_vertical_workflow_uses_real_receiving_and_square_consumption -vv -x -s --durations=20
```

The test runs in the backend job's PostgreSQL 16 service using the existing `postgres_app` fixture. That fixture creates disposable migrator/runtime roles, applies the current migrations and RLS policies, seeds the local test organization/location, and tears the database down after the test. The test creates unique records for one organization/location only; it does not use a Production URL, Square credentials, Clover credentials, Render configuration, or external provider calls.

Evidence run: [GitHub Actions run 40341272838](https://github.com/ter-ry/restaurant-helper/actions/runs/40341272838)  
Evidence commit: `ba82ae806f2a235a939c25796441733cb56b0442`

Expected and observed values:

| Check | Independent expectation | Observed |
|---|---:|---:|
| Starting inventory | 10 kg at $2/kg | 10 kg at $2/kg |
| Purchase receive | +5 kg at $3/kg | +5 kg; on-hand 15 kg |
| Weighted average cost | (10×2 + 5×3) / 15 = $2.3333/kg | $2.3333/kg |
| Purchase receipt movements | exactly one for the invoice | one |
| Recipe usage | 0.25 kg/serving × 2 servings = 0.50 kg | 0.50 kg |
| Mapped completed Square sale | one order, two servings | one sale movement; on-hand 14.50 kg |
| Duplicate replay | no second deduction | no second movement; remains 14.50 kg |
| Unmapped variation | no recipe/inventory deduction | warning returned; no movement; remains 14.50 kg |
| Recipe/menu source data | unchanged by sale ingestion | recipe quantity and menu price unchanged |

The test uses the real receiving endpoint and the real `_upsert_order()` / `_apply_square_order_inventory_consumption()` services. It does not call a reset helper, fabricate a supplier invoice, or write to Production.

## System data flow

```
Invoice upload/OCR
  -> purchase draft and reviewSummary
  -> explicit review corrections
  -> receive transaction
  -> inventory movements + weighted-average cost
  -> recipe/menu costing reads current inventory costs
  -> Square completed-order ingestion
  -> mapped recipe ingredient consumption movements
  -> stock counts and bounded physical usage
  -> Daily Close reconciliation
  -> Dashboard / Reports read trusted aggregates
```

The audited boundaries are:

- Purchases and OCR own invoice review state and arithmetic/readiness decisions.
- Receiving is the write boundary for purchase-driven inventory movements and cost updates.
- Inventory movements and item cost fields are the quantity/cost source used by recipes.
- Recipes and menu items provide the menu-costing calculation.
- Square order persistence and mapping drive POS-derived theoretical consumption; unmapped items must not consume recipes.
- Stock counts provide physical opening/closing evidence for variance.
- Daily Close and Reports consume finalized sales, cash/reconciliation and valid count boundaries rather than inventing a second stock algorithm.
- Dashboard surfaces a concise subset of those trusted results.

## Remaining verification matrix

| Area | Status | Evidence or limitation |
|---|---|---|
| Purchase receive, inventory movement and weighted-average cost | **Passed in CI** | Executed by the vertical PostgreSQL test above with independent Decimal assertions. |
| Square mapped consumption and duplicate replay | **Passed in CI** | Real ingestion services; one movement only after replay. |
| Unmapped Square item safety | **Passed in CI** | Warning returned and no inventory movement. |
| OCR extraction/review and arithmetic correction | Partial | Existing backend/frontend/Playwright coverage; no external OCR provider call. |
| Stock counts and physical variance | Unverified in this scenario | No opening/closing stock-count transaction was added to this focused test. |
| Daily Close and Dashboard populated read | Unverified in this scenario | No full close/dashboard read was added; valid physical boundaries remain required. |
| Reports/menu-costing post-receive browser flow | Partial | Existing CI coverage and static boundary review; not a new populated browser scenario here. |
| PostgreSQL migrations/RLS/tenant isolation | **Passed in CI** | Full backend job passed, including migration, RLS/security and tenant-isolation checks. |
| Frontend unit/typecheck/lint/build/Playwright | **Passed in CI** | Full frontend job passed. |
| Real OCR/Square authentication | Unverified | Intentionally outside mocked, read-only CI scope. |

## Safety findings

- No Production database, Square merchant, Clover API or Render configuration was accessed or changed.
- No seed/reset helper or Production fixture was run.
- No schema migration or application code change was required.
- The only application-adjacent changes are the focused PostgreSQL integration test, its explicit CI invocation, and this evidence document.
- Existing tenant/RLS and authorization coverage remains a release gate.
- Clover remains a separate read-only/disabled-by-default foundation and is not part of pilot readiness.

## Defects and limitations

### Confirmed P0/P1 defects

None confirmed by this audit.

### Remaining unverified risks

1. A complete stock-count → variance → Daily Close → Dashboard populated scenario still needs isolated execution.
2. Real OCR and real Square authentication remain external/manual verification items.
3. Mobile/tablet browser completion should be re-run with the authenticated E2E fixture when that fixture is available.

## Tests and evidence

The final CI run for the evidence commit must remain green for:

- backend unit tests;
- PostgreSQL migration acceptance;
- PostgreSQL RLS/security and tenant isolation;
- the dedicated PostgreSQL vertical workflow test above;
- frontend unit tests;
- typecheck and lint;
- production build;
- Playwright browser tests.

## Pilot decision

**CONDITIONAL GO** for a controlled first pilot only after:

1. the remaining stock-count/Daily Close/Dashboard scenario is executed in an isolated database;
2. the full CI matrix is green on this audit PR;
3. a human verifies the real OCR provider and real Square connection in a non-destructive pilot environment;
4. the operator confirms no Production data was used during test setup.

Do not describe the complete restaurant workflow as fully verified end to end until those remaining items are executed.
