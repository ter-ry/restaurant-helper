# Square Production showcase sales runbook

This runbook is for the dedicated Flowtally Production showcase seller only. It is a controlled Square fixture utility, not a general tenant seeder.

## Identities and credentials

- The Square seller location is **Flowtally**. This is the location returned by Square and is distinct from the Flowtally mapped restaurant location, **Harbour Kitchen**.
- The expected Production catalog variation is **Harbour Burger · Base**, mapping to the Flowtally menu item **Harbour Burger**. The utility discovers the live CAD price from Square and fails safely if this exact variation is absent.
- Use the separate temporary Square utility app's Production personal/access token for this dedicated showcase seller.
- Do not copy or reuse Flowtally's merchant OAuth token, Flowtally's OAuth client secret, or credentials from another seller.
- The utility requires `SQUARE_SHOWCASE_ACCESS_TOKEN`, `SQUARE_SHOWCASE_EXPECTED_MERCHANT_ID`, `SQUARE_SHOWCASE_EXPECTED_LOCATION_ID`, and `SQUARE_SHOWCASE_EXPECTED_LOCATION_NAME=Flowtally`.
- The utility uses Square's fixed Production API host; do not override it with another environment or host.

## Safe dry run

The default fixture is one order with one Harbour Burger serving. Inspect identity, catalog variation, totals, and the inventory warning before any write:

```powershell
python scripts/seed_square_showcase_sales.py --environment production --fixture-name harbour-kitchen-sales --dry-run
```

The dry run prints `paymentType: CASH`, the planned totals, and a warning that Flowtally Sync Orders consumes mapped recipe inventory. Verify ingredient stock before using a larger fixture.

## Production write

Only after reviewing the dry run, use the explicit Production confirmation:

```powershell
python scripts/seed_square_showcase_sales.py --environment production --fixture-name harbour-kitchen-sales --confirm-showcase-production --manifest .\square-showcase-harbour-kitchen.manifest.json
```

The safe default is one order / one burger. Fixtures with more than one order require the additional `--confirm-inventory-reviewed` flag after manually checking Harbour Kitchen ingredient stock. Existing maximum order and serving limits still apply:

```powershell
python scripts/seed_square_showcase_sales.py --environment production --fixture-name harbour-kitchen-sales --orders 3 --confirm-inventory-reviewed --confirm-showcase-production --manifest .\square-showcase-harbour-kitchen.manifest.json
```

Do not run the richer fixture until inventory has been reviewed and replenished if needed. Flowtally Sync Orders causes mapped recipe inventory consumption.

## Recording fixture

The named recording profile is deliberately fixed at 8 completed orders and 10 burger servings:

```powershell
python scripts/seed_square_showcase_sales.py --environment production --fixture-name alpha-video-full-sales-2026-10 --dry-run --confirm-inventory-reviewed
```

Review every planned order, the total gross/discount/tip/final totals, and the inventory warning before using the explicit write command. Totals are calculated from the price returned by Square's discovered Production catalog variation; the utility does not assume a fixed live price. For reference only, at a CAD 15.00 variation price this profile is gross CAD 150.00, discounts CAD 2.25, tips CAD 3.75, and final CAD 151.50. The live dry-run remains authoritative.

```powershell
python scripts/seed_square_showcase_sales.py --environment production --fixture-name alpha-video-full-sales-2026-10 --confirm-inventory-reviewed --confirm-showcase-production --manifest .\square-showcase-alpha-video-full-sales-2026-10.manifest.json
```

The profile cannot be changed to another order count. Reusing the same fixture name preserves its idempotency keys and manifest.

## Showcase inventory preparation

Before the recording fixture, inspect the live target quantities with the guarded application command. It verifies the production database, organization, location, exact item names and stock units and makes no changes in dry-run mode:

```powershell
flask --app backend.wsgi showcase-replenish --organization-id 1 --location-id 1 --owner-id 1 --dry-run
```

The target-based write, after reviewing the dry run, requires the explicit production acknowledgement:

```powershell
flask --app backend.wsgi showcase-replenish --organization-id 1 --location-id 1 --owner-id 1 --confirm-production
```

It records normal inventory movements and audit events with reason `showcase inventory replenishment`; running it again at the targets adds zero. It never fabricates a supplier invoice and never changes costs or prices.

## Variance recording sequence

To demonstrate Usage / Variance with physical evidence:

1. Replenish the three Harbour Burger ingredients and complete an opening physical stock count.
2. Run and sync the 8-order/10-burger Square recording fixture.
3. Confirm recipe-driven inventory consumption in Inventory History.
4. Complete a later physical stock count for the same ingredients.
5. Usage / Variance then compares the distinct count boundaries with POS theoretical usage. A same-session or non-later boundary is unavailable by design and cannot produce a zero-usage or `-100%` variance.

Positive variance means more physical stock disappeared than recipe/POS usage predicted; negative means less disappeared; zero means the two agree. Do not create synthetic stock-count rows through SQL. Any intentional discrepancy must be documented as synthetic showcase data.

Future enhancement: add Production Square catalog variations for Chicken Rice Bowl, Toronto Breakfast, House Salad and Iced Latte, then map them to existing Flowtally menu/recipe records. This is documented only and is not part of the current alpha fixture.

## Manifest

The local, non-secret manifest is idempotent state for this fixture. It records the fixture name, order number, quantity, Square order ID, payment ID, gross/discount/tip/final totals, currency, catalog variation ID, Square location ID, `paymentType: CASH`, status, and returned created/closed timestamps. Fixture-level planned and completed totals include order count, total burger quantity, and money totals. It never stores an access token, OAuth secret, authorization header, or payment credential. Re-running the same fixture reuses completed orders and leaves completed totals unchanged.

## Cleanup

After the showcase exercise, remove or rotate the temporary utility Production token in Square. Do not leave that temporary token in shell history, source control, manifests, Render, or Flowtally's OAuth configuration.
