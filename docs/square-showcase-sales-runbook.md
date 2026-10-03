# Square Production showcase sales fixture

This runbook is for a dedicated Flowtally showcase/test merchant only. It is
not part of OAuth, the Flowtally database seed, or the public demo. The utility
creates three small CAD cash orders for the existing `Flowtally Test Burger ·
Base` Square catalog variation so Flowtally can ingest real completed order
records and demonstrate recipe-driven theoretical usage.

## Before a Production write

Obtain a temporary Square Production access token for the dedicated showcase
merchant through the existing Square application. Keep it in the current shell
only; never put it in Render, git, a manifest, a ticket, or a log. The token
must have the Square permissions required by the write endpoints: `ORDERS_WRITE`
and `PAYMENTS_WRITE`, in addition to the read permissions used by Flowtally.
This temporary token does not change Flowtally's OAuth scopes or application
configuration.

Set these non-secret identity variables in the same shell:

```powershell
$env:SQUARE_SHOWCASE_ACCESS_TOKEN = '<temporary token>'
$env:SQUARE_SHOWCASE_EXPECTED_MERCHANT_ID = '<dedicated seller id>'
$env:SQUARE_SHOWCASE_EXPECTED_LOCATION_ID = '<Harbour Kitchen Square location id>'
$env:SQUARE_SHOWCASE_EXPECTED_LOCATION_NAME = 'Harbour Kitchen'
```

The command refuses to write unless the token can read exactly the configured
merchant and location and discovers exactly one CAD variation named
`Flowtally Test Burger · Base`. It does not substitute an ad-hoc item.

## Dry run

Use a manifest outside the repository. The dry run performs only merchant,
location, and catalog reads:

```powershell
python scripts/seed_square_showcase_sales.py `
  --environment production `
  --fixture-name alpha-video-2026-10 `
  --manifest "$env:TEMP\flowtally-alpha-video-2026-10.json" `
  --dry-run
```

Review the printed quantities, gross/discount/tip/total amounts, CAD currency,
cash payment type, location, and exact variation ID. The default fixture is
three orders with quantities 1, 2, and 1. A fourth/fifth order can be requested
with `--orders`; more than five is rejected and total burger servings are
bounded. The fixture is intentionally small because each completed burger order
will consume the burger recipe's mapped ingredients when Flowtally syncs it.

## Explicit Production write

After reviewing the dry run, run exactly once with the explicit guard:

```powershell
python scripts/seed_square_showcase_sales.py `
  --environment production `
  --fixture-name alpha-video-2026-10 `
  --manifest "$env:TEMP\flowtally-alpha-video-2026-10.json" `
  --confirm-showcase-production
```

The sequence is Square Create Order, Create Payment with `source_id=CASH`, and
Pay Order. Orders use deterministic reference and idempotency keys, and the
manifest records only safe order/payment IDs, statuses, totals, quantities,
timestamps supplied by Square, the variation/location IDs, and payment type.
Rerunning with the same fixture and manifest retrieves completed orders instead
of creating new ones; if an interrupted order is present, it resumes the
deterministic payment/finalization steps. A failed request reports only a safe
status and Square request ID.

After the write, remove the token from the shell and delete the local manifest
when it is no longer needed. Flowtally still requires its normal Square sync to
ingest these orders; the utility does not write Flowtally inventory, purchases,
stock counts, recipes, or menu items directly. Inventory depletion follows the
existing mapped recipe and only occurs when Flowtally syncs the completed order.

Square's Orders API requires `ORDERS_WRITE` to create/pay orders and the
Payments API requires `PAYMENTS_WRITE` to record cash payments. The utility
therefore uses a separately authorized temporary token and does not alter the
read-only production OAuth scope configuration.
