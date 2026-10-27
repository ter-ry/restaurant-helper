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

Run from the repository root. The token is collected as a
`SecureString` so it is not included in PowerShell command history. It is
held briefly in the process environment only while the module runs, then
cleared in `finally` even if the request fails.

```powershell
$env:CLOVER_SANDBOX_MERCHANT_ID = "V7SXJVSGY5051"
$secureToken = Read-Host "Clover Sandbox API token" -AsSecureString
$tokenPtr = [IntPtr]::Zero
try {
    $tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:CLOVER_SANDBOX_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
    python -m scripts.clover_catalog_smoke
}
finally {
    if ($tokenPtr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
    }
    Remove-Item Env:CLOVER_SANDBOX_MERCHANT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:CLOVER_SANDBOX_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Variable secureToken,tokenPtr -ErrorAction SilentlyContinue
}
```

The command prints normalized merchant, location, item, category, item-group,
option and modifier metadata. It never prints the token or authorization
headers. A successful run prints JSON to stdout and a fixture verification
message to stderr.

The module invocation is intentional: it starts from the repository root with
the repository package layout on `sys.path`.

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
