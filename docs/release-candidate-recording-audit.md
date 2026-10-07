# Final Flowtally recording handoff

**Audit date:** 2026-10-07
**Repository baseline:** `origin/main` at `9d821f0701a9cfdb5bc660715ecc08f9364c4fa2`
**Production workspace:** Flowtally Showcase / Harbour Kitchen

This is the authoritative read-only recording handoff for the current Production state. No Production data, Square data, credentials, mappings, configuration, or close sessions were changed during this audit.

## Baseline and merged delta

The audit branch starts from the current `origin/main`, which includes the merged showcase work in PRs #108–#114. The relevant delta covers Square reference/idempotency safety (#108), Square and usage correctness (#109), timezone and presentation cleanup (#110), variance/read-only layout polish (#111), guarded showcase sales and inventory preparation (#112), the 23-item inventory profile (#113), and recording-readiness/audit documentation plus the Harbour Burger fixture alignment (#114).

GitHub CI and the deploy workflow for `9d821f0` completed successfully. The current branch has no application-code changes.

## Production availability

`https://api.flowtally.ca/api/health` returned HTTP 200 and the actual JSON response:

```json
{"csrfEnabled":true,"databaseUrlConfigured":true,"environment":"production","googleOidcEnabled":true,"ocrConfigured":true,"service":"flowtally-pilot-backend","squareEnabled":true,"status":"ok"}
```

The Production frontend loaded at `https://app.flowtally.ca/app/dashboard`, and the existing showcase login/session worked. The first load of several authenticated pages briefly showed the normal pilot loading state, then resolved; this was not a Render loading-page failure. No Render intervention was required.

## Verified live data

### Tenant, location, and Square

- Organization: `Flowtally Showcase`
- Restaurant location: `Harbour Kitchen`
- Square seller location displayed in Flowtally: `Flowtally`
- Flowtally location mapping: `Flowtally` → `Harbour Kitchen`, `1/1 mapped`
- Square catalog variation: `Harbour Burger · Base`
- Flowtally mapping: `Harbour Burger · Base` → `Harbour Burger`, `1/1 mapped`
- Connection state: Ready / connected
- Last sync shown: Oct 7, 2:32 p.m.
- Catalog concern: resolved in the live screen; the old `Flowtally Test Burger` name was not present.

### Inventory and counts

The live Inventory page shows the expected 23-item profile: 16 in stock/healthy, 4 low stock, 2 Reorder now, and 1 Out of stock.

Presentation anchors:

| Item | Current quantity | Status |
|---|---:|---|
| Chicken Breast | 8.2 kg | In stock |
| Bread Buns | 17.5 pack | In stock |
| Lettuce | 6.7 head | In stock |
| Cups | 224 each | In stock |
| Eggs | 0 dozen | Out of stock |
| Tomato Sauce | 1 L | Reorder now |
| Tapioca Pearls | 1 kg | Reorder now |

Completed Stock Counts #3 and #4 exist on Oct 7. Count #4 is the visible closing snapshot: Chicken Breast 8.2 kg, Bread Buns 17.5 pack, and Lettuce 6.7 head, with a deliberate Lettuce variance of -0.1 head.

### Purchase proof

The strongest existing completed purchase is `HD-5501` from Harbour Dry Goods, received Sep 29, total `$49.55`, locked/read-only, six invoice items, and 92% line confidence. It includes Rice, Noodles, Pasta, Sugar, Vegetable Oil, and Bread Buns. Its source is `HD-5501.pdf`; the record identifies its extraction status as manual/seeded, so it must not be described as a live OCR capture.

### Menu and recipe proof

- Menu item: `Harbour Burger`
- Selling price: `$18.00`
- Recipe: Harbour Burger, active, yield 1 serving
- Recipe cost: `$2.21`; food cost `12.3%`; gross profit `$15.79`
- Ingredients shown in the recipe: Chicken Breast 0.2 kg, Bread Buns 0.3 pack, Lettuce 0.1 head
- Usage / Variance preserves higher precision for the theoretical usage calculation; use that page for exact 0.18 / 0.25 / 0.12 per-serving proof.

### Square sales and movement proof

The Square page shows eight completed Oct 7 orders at the `Flowtally` location, with displayed line quantities summing to ten Harbour Burger servings and displayed daily net/gross sales of `$181.80`. It also shows zero refunds, zero tips, and zero cancelled orders. The visible order references include `82FrRkqSK4TPBAEcCgnbhMIDVWTZY`, `CdNskqRiBB6O3MtXKPnxtpXrK3eZY`, `kuvHzNrWfLF0UQT63dSfHi0P8OFZY`, `UsIazvdfva2e2gO4VHftzpT7VU7YY`, `mNuhayPUHeHeLbuWnM5yOB1burMZY`, `sSDnK9rE9wlG73x1VFBWN7UcC4cZY`, `EIIXuLLpekFnx7LVPCZp37ZdLGOZY`, and `0kGvLpwK36D0ebLq3fAMH2WFU5RZY`.

The live Usage / Variance page, however, reports **12 sold menu units**, 3 ingredient rows, and 100% mapped coverage even when the read-only window is narrowed to Oct 7 2:23–2:25 p.m. It reports Chicken Breast theoretical usage 2.16 kg and count-derived usage 4.16 kg, while Bread Buns and Lettuce have no physical usage available. This conflicts with the eight-order/ten-serving handoff and the expected 1.80 / 2.50 / 1.20 theoretical usage.

The inventory movement history does show persisted Square recipe-consumption rows for the Oct 7 order references, including Chicken Breast, Bread Buns, and Lettuce. The exact sales-to-usage/count evidence is not currently coherent enough to record as the promised 10-serving proof.

### Reorder proof

Reorder Plan currently contains seven items below PAR: Eggs, Tapioca Pearls, Tomato Sauce, Coffee Beans, Noodles, Onions, and Pasta. The three urgent rows are Eggs (Out of stock), Tapioca Pearls (Reorder now), and Tomato Sauce (Reorder now). The Inventory button `Reorder list (2)` counts only the two `Reorder now` statuses; Reorder Plan’s `Needs reorder 7` includes low-stock and out-of-stock items. These are different scopes, not the same metric.

### Daily Close

There is no current Daily Close session and no completed close history. Drafts for Oct 6 and Oct 4 are present. Do not start, edit, or complete a close during recording.

## Concern classifications

- **A — Square catalog stale:** **RESOLVED.** Production shows `Harbour Burger · Base` and the existing mapping is healthy. Do not sync again during recording.
- **B — Gross / Tips / Net semantics:** **AFTER RECORDING / AVOID.** The live summary shows `$181.80` for both Net and Gross and `$0.00` Tips. Do not narrate those fields as a tip-inclusive financial reconciliation. If this is shown, describe it only as imported Square order activity. The guarded fixture’s planned totals and the persisted order summary should be reconciled in a separate code/data investigation.
- **C — Reorder counts:** **IGNORE.** `Reorder list (2)` is the immediate Reorder-now count; `Needs reorder 7` is the full below-PAR list. Use the Reorder Plan rows, not the two badges interchangeably.
- **D — Recipe precision:** **AFTER RECORDING / AVOID.** Menu Costing displays recipe quantities to one decimal (`0.2`, `0.3`, `0.1`); Usage / Variance displays the precise per-serving quantities. Use Usage / Variance for precision-sensitive narration.

## Recording decision

**NOT READY TO RECORD.** Production availability, tenant identity, catalog mapping, inventory anchors, and a real Square order-to-movement trail are present. Recording is blocked by the unresolved 10-versus-12 sales-unit discrepancy and incomplete/incorrect physical Usage / Variance evidence for the promised Oct 7 window. No new Square transaction, sync, count, reseed, or Production mutation is authorized by this handoff.

## Candidate recording sequence after the blocker is resolved

### 10–15 minutes

1. Dashboard — owner attention panel, current reorder pressure, and recent Square-driven activity (1:00).
2. Purchases — open completed `HD-5501`; show supplier, six mapped lines, total, locked/read-only state, and the manual/seeded extraction note (1:30).
3. Inventory — show Chicken Breast 8.2 kg, Bread Buns 17.5 pack, Lettuce 6.7 head, Cups 224 each; open Chicken Breast history and show receipts plus the verified Square movement (2:00).
4. Menu Costing — open Harbour Burger recipe and cost; avoid presenting rounded quantities as the exact sales calculation (1:30).
5. Square — show Ready, `Flowtally` location, Harbour Burger mapping, and the existing completed order list. Avoid the misleading Gross/Tips/Net narrative until semantics are reconciled (2:00).
6. Usage / Variance — set the verified final window only after the data discrepancy is resolved; show 100% coverage, exact theoretical usage, count-derived usage, and one deliberate Lettuce variance (3:00).
7. Reorder Plan — show Eggs, Tapioca Pearls, and Tomato Sauce; do not click Add to draft (1:00).
8. Return to Dashboard for the owner close (1:00).

### 5-minute abbreviated version

1. Dashboard attention panel (0:45).
2. Square mapping and one real completed order (1:00).
3. Usage / Variance exact sale-to-recipe-to-ingredient proof (1:30).
4. Inventory movement history for the same order (0:45).
5. Reorder Plan urgent rows and Dashboard close (1:00).

## Recording risks and fallbacks

- Do not record until the Usage / Variance discrepancy is explained and the exact window shows the intended servings and count coverage.
- Do not create another Square transaction. The existing Oct 7 activity is sufficient for investigation.
- Do not show Daily Close, draft records, connection controls, Save mapping, Import menu, Sync controls, New count, Add to draft, or any browser/developer tooling.
- If the Square financial summary remains semantically ambiguous, skip that summary block and use the order list plus Usage / Variance movement proof only after the unit discrepancy is resolved.
- If the production data cannot be reconciled read-only, stop the rehearsal and report the missing proof rather than changing Production.
