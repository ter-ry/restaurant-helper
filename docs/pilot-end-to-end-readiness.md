# Flowtally End-to-End Workflow Audit and Pilot Readiness

Date: 2026-10-26  
Repository baseline: `main` at `8f7f46a0fa7a6e8f9df859b2cf7095f712d2d8a0`

## Recommendation

**CONDITIONAL GO**

The repository contains the intended purchasing, inventory, recipe costing, Square ingestion, Daily Close, dashboard and reporting paths, and the existing automated CI suite covers the main authorization, tenant-isolation, migration, frontend and browser journeys. This audit did not identify a confirmed new P0/P1 defect from static inspection.

A complete isolated database-backed and browser-executed restaurant scenario could not be claimed in this environment. The active local workspace is not the `ter-ry/restaurant-helper` checkout, and no writable isolated PostgreSQL instance, seeded test organization, or clean preview/API fixture environment was available. No write testing was attempted as a result.

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

## Verification matrix

| Area | Static review | Isolated execution | Status |
|---|---|---|---|
| Invoice OCR extraction and review | Purchase UI/API and OCR review paths present; structured review and source evidence are covered by existing browser journeys | Not run with an isolated database | Partial |
| OCR correction blocking | Existing review summary/readiness path inspected; backend enforcement remains authoritative | Not run end to end here | Partial |
| Receive purchase | Receive path and duplicate/uncertain-response protections are present in current code and tests | No isolated receive transaction executed | Partial |
| Inventory movements and weighted-average cost | Receiving and Square consumption paths use movement/cost services; no direct Production data accessed | Independent numeric scenario not executed here | Partial |
| Stock counts and variance | Daily Close/Usage code requires valid physical count boundaries | No stock-count transaction executed here | Partial |
| Menu costing | Recipe/menu-costing code reads inventory cost state | No post-receive cost-change browser run here | Partial |
| Square location/catalog/order mapping | Current code includes mapping guards, canonical order handling and idempotent ingestion tests | No live Square calls or Production orders | Mocked/CI only |
| Square inventory deduction | Mapping and duplicate-delivery protections are covered by repository tests | No Production or external Square writes | Mocked/CI only |
| Daily Close | Business-date, cash and theoretical/physical boundary logic inspected | No isolated close/reopen scenario executed here | Partial |
| Dashboard and Reports | Existing reporting and dashboard routes consume trusted report aggregates | No isolated populated-dashboard run here | Partial |
| Tenant isolation/RLS | Existing CI matrix includes PostgreSQL migrations, RLS and tenant isolation jobs | No local PostgreSQL instance available | CI required |
| Mobile/browser usability | Existing Playwright suite covers commercial and operational journeys | Fresh run from this environment unavailable | CI required |

A row is marked Partial or Mocked/CI only where the complete workflow was not actually executed. No such row is being reported as passed.

## Scenario definition for the next isolated run

The following deterministic scenario should be executed in a writable PostgreSQL-backed test organization:

- Two suppliers.
- At least eight inventory items spanning kg, pack, head, each, dozen and litre units.
- Five menu items, including one Square-mapped variation and one intentionally unmapped variation.
- Two invoices with one OCR correction and one arithmetic exception.
- A completed receive for the corrected invoice.
- Multiple completed Square-style orders, including a duplicate delivery and an unmapped item.
- One opening and one closing stock count that genuinely bracket the test period.
- One Daily Close session and one report/dashboard read.

Expected values must be computed independently before execution. At minimum record:

- received stock delta and after-on-hand;
- weighted-average unit cost;
- recipe/menu cost and food-cost percentage;
- completed order count, units, gross item sales, discounts, tips, refunds and total collected;
- mapped theoretical usage and resulting inventory movement count;
- opening/closing counts, qualifying movements and variance;
- Daily Close and Dashboard values compared with the same source transactions.

## Safety findings

- No Production database, Square merchant, Clover API or Render configuration was accessed or changed.
- No seed/reset helper or Production fixture was run.
- No schema migration or application code change was required by this audit.
- Existing tenant/RLS and authorization coverage remains a release gate.
- Clover remains a separate read-only/disabled-by-default foundation and is not part of pilot readiness.

## Defects

### Confirmed P0/P1 defects

None confirmed by the static audit.

### Unverified risks

1. The full OCR-to-receive-to-cost-to-dashboard chain still needs a single isolated execution with independently calculated expected values.
2. Square theoretical consumption and duplicate delivery behavior needs the same isolated scenario, using mocked provider responses and the real application ingestion services.
3. Mobile/tablet browser completion should be re-run after the authenticated E2E fixture is available.
4. Real OCR and real Square authentication remain external/manual verification items.

## Tests and evidence

Repository CI is the authoritative execution path for this branch. The existing workflow includes:

- backend unit tests;
- PostgreSQL migration acceptance;
- PostgreSQL RLS/security and tenant-isolation checks;
- frontend unit tests;
- typecheck and lint;
- production build;
- Playwright browser tests.

This report intentionally does not substitute static inspection for those executions. The isolated workflow scenario above remains a follow-up requirement before upgrading this recommendation to GO.

## Pilot decision

**CONDITIONAL GO** for a controlled first pilot only after:

1. the isolated PostgreSQL-backed scenario is executed and its independently calculated numbers match;
2. the full CI matrix is green on this audit PR;
3. a human verifies the real OCR provider and real Square connection in a non-destructive pilot environment;
4. the operator confirms no Production data was used during test setup.

Until those steps are complete, do not describe the complete restaurant workflow as fully verified end to end.
