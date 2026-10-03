# Square Production showcase sales runbook

This runbook is for the dedicated Flowtally Production showcase seller only. It is a controlled Square fixture utility, not a general tenant seeder.

## Identities and credentials

- The Square seller location is **Flowtally**. This is the location returned by Square and is distinct from the Flowtally mapped restaurant location, **Harbour Kitchen**.
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

## Manifest

The local, non-secret manifest is idempotent state for this fixture. It records the fixture name, order number, quantity, Square order ID, payment ID, gross/discount/tip/final totals, currency, catalog variation ID, Square location ID, `paymentType: CASH`, status, and returned created/closed timestamps. Fixture-level planned and completed totals include order count, total burger quantity, and money totals. It never stores an access token, OAuth secret, authorization header, or payment credential. Re-running the same fixture reuses completed orders and leaves completed totals unchanged.

## Cleanup

After the showcase exercise, remove or rotate the temporary utility Production token in Square. Do not leave that temporary token in shell history, source control, manifests, Render, or Flowtally's OAuth configuration.
