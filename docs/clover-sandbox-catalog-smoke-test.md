# Local Clover Sandbox Catalog Smoke Test

This is a local-only, read-only smoke test for the existing
`backend.clover_catalog.CloverCatalogClient`.

It is intentionally limited to Clover Sandbox:

- fixed API host: `https://apisandbox.dev.clover.com`
- GET requests only
- no catalog persistence or Flowtally database writes
- no OAuth credential changes
- no Production calls

The utility verifies the known Sandbox fixture:

- merchant: Flowtally Test Kitchen
- merchant ID: V7SXJVSGY5051
- item: Test Burger
- item ID: TE0BYZH7B28AJ
- price: 1800 cents (CAD $18.00)

## Windows PowerShell

Run from the repository root. Supply the merchant-specific Sandbox token
locally; do not paste it into chat, commit it, or put it in a file tracked by
Git.

```powershell
$env:CLOVER_SANDBOX_MERCHANT_ID = "V7SXJVSGY5051"
$env:CLOVER_SANDBOX_API_TOKEN = "<paste-the-sandbox-token-locally>"
python scripts/clover_catalog_smoke.py
```

The command prints normalized merchant, location, item, category, item-group,
option and modifier metadata. It never prints the token or authorization
headers. A successful run prints JSON to stdout and a fixture verification
message to stderr.

Remove the variables after the run if they are no longer needed:

```powershell
Remove-Item Env:CLOVER_SANDBOX_MERCHANT_ID -ErrorAction SilentlyContinue
Remove-Item Env:CLOVER_SANDBOX_API_TOKEN -ErrorAction SilentlyContinue
```

The process sets the shared `CLOVER_CATALOG_ENABLED` gate internally for this
one explicit local invocation. The application gate remains
disabled-by-default elsewhere.

## Outcomes

- Exit 0: catalog fetched, normalized and Test Burger matched.
- Exit 1: safe provider/request failure.
- Exit 2: required environment variable missing or disabled configuration.
- Exit 3: Clover reported a bounded/incomplete response.
- Exit 4: the expected Test Burger identity or price was not present.

No live call is made automatically by CI or by importing the utility.
