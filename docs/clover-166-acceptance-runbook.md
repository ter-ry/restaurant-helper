# Clover inventory acceptance runbook (#166), owner-run

Docs only. No agent runs this. Clover inventory writes stay disabled until the owner explicitly executes step 5, and the flag is restored afterwards. Written 2026-11-18 from the code at main `99f232b`.

## Finding: why order `80CM9MTRVQ7C4` is not an eligible sale

Observed in the owner's GET-only checks: order state `OPEN`, `paymentState` `OPEN`, total 1800, one payment `75A57AHVQX6AY` with result `SUCCESS` for 1800, no refunds.

Flowtally's classification (`backend/clover_orders.py`, `classify_order`):

1. The payment is `SUCCESS` and equals the total, but the order itself still says `OPEN`/`OPEN`. That contradiction sets `paymentStateConflict`.
2. In the `OPEN` branch this yields `normalized_status="review"`, `potentially_eligible=False`, `requires_review=True`.
3. Inventory planning (`backend/clover_inventory.py`) returns `eligible: false`, reason `order_not_financially_verified` (or `financial_or_line_data_incomplete`). No `InventoryMovement` is created even with the flag on.
4. This is **expected fail-closed behavior, not a Flowtally defect.** An existing test (`backend/tests/test_clover_orders.py`, payment-level refund expansion) already uses this same payment id and asserts `review`, not eligible, `paymentStateConflict` true.

What it means in Clover terms (inference, not verified against Clover internals): a payment record was attached to the order, for example through the Sandbox dashboard or a direct payment call, but the order was never moved to `PAID`/`CLOSED`. Clover therefore exposes a payment that succeeded without confirming that the order is paid. Flowtally requires both to agree, so it will not treat it as a sale. Correction (2026-11-19, from Clover docs `ordercreatepaymentfororder`): the payments POST on the Platform API logs external tenders for bookkeeping and is not the card-payment flow. The supported ways to get a PAID order are the Ecommerce pay endpoint (`POST https://scl-sandbox.dev.clover.com/v1/orders/{orderId}/pay`, see `create-an-atomic-order` and `postordersidpay`) or a real Sandbox Register/device checkout. Flowtally should not be loosened to accept the payment alone, since that would count unreconciled or external tenders as sales.

**Retrieval window.** `fetch_orders` filters on `modifiedTime`. With no dates the default is the last 7 days, so an October order is outside it today. The fetch endpoint accepts `startDate` and `endDate` up to 90 days apart (maximum 3 pages by default, 5 at most, 50 per page). Even inside the window this order would still classify as `review`, so the window is not the blocker. A fresh paid order avoids the question.

## Preconditions (read-only checks)

1. Environment and deployed SHA/Alembic head recorded on #165, with `CLOVER_ORDER_INVENTORY_ENABLED` currently off. The deployed head must include 0029.
2. Sandbox merchant connected (`connection.status=connected`, `environment=sandbox`). Production is never used.
3. A mapped test item: the Clover line item is mapped to a Flowtally menu item with a recipe, and every ingredient is an active inventory item with a compatible unit.
4. Record on-hand and weighted-average cost for each ingredient (screenshots or exported rows).

## Procedure

1. **Create a genuinely paid order (owner-run, needs separate authorization; see "Supported paid-order procedure" below).** Do not use `POST .../orders/{orderId}/payments` on the Platform API: Clover documents it as an external-tender bookkeeping record, so it can produce exactly the `SUCCESS` payment on an `OPEN`/`OPEN` order that we saw on `80CM9MTRVQ7C4`. Then run the GET-only checks: `paymentState=PAID`, one `SUCCESS` payment equal to the total, refunds 0.
2. **Read-only eligibility in Flowtally.** Call `POST /api/integrations/clover/shadow-orders/fetch` with `{"dryRun": true, "startDate": "<before order>", "endDate": "<now>"}` (no `executeInventory`). This ingests the shadow order only and applies nothing. Expect `status=paid`, `inventoryAutomation.dryRun=true`, a result with `eligible: true`, and a movements list showing recipe quantity times line quantity per ingredient. If `eligible` is false, stop and record the `reason`. Do not proceed.
3. **Expected change.** One negative `InventoryMovement` per ingredient (`source_type="clover sale consumption"`, `source_record_id=<order id>`, `source_line_id="clover:<ledger id>:<n>"`). `current_on_hand` drops by exactly the planned quantities. Weighted-average cost is unchanged by a consumption.
4. **Backup and flag.** Owner records the current flag value and that a rollback path exists.
5. **One authorized execution (Showcase only).** The owner temporarily sets `CLOVER_ORDER_INVENTORY_ENABLED=true` on Showcase, then calls the same fetch with `"executeInventory": true` (JSON boolean; any other value is ignored). Expect `applied: true`. Record the response and the movement rows.
6. **Idempotent replay.** Repeat step 5 once or twice with the same window. Expect no new movements (`state: unchanged`) and no change in on-hand.
7. **Reconciliation.** Per ingredient: opening on-hand minus the sum of the Clover movements equals closing on-hand, and the movement ledger reconciles to on-hand. Confirm the audit event `clover.shadow_orders.ingested` shows `inventoryAutomation: true` for the run.
8. **Optional negative checks (only if the owner wants them).** Re-fetch the original `OPEN`/`SUCCESS` order `80CM9MTRVQ7C4` with the flag on and confirm it stays `review` with zero movements. A refund of the new order would exercise reversal, but it is a Sandbox write and needs its own owner approval.
9. **Restore.** Set `CLOVER_ORDER_INVENTORY_ENABLED` back to its recorded value (off), confirm via the health or config check, and record the final flag value, deployed SHA and movement ids on #166 and #165.

## Smallest owner action

Complete one new Sandbox sale through a supported payment flow (below) so the order itself reaches `paymentState=PAID`, then run steps 2 and 5 to 9 above.

## Supported paid-order procedure (Windows PowerShell 5.1+, owner-run)

Status: **verified against Clover documentation on 2026-11-19; not executed.** Every stage that sends a POST is a Clover write and needs the owner's explicit approval in the live session for that stage only. Sandbox hosts only. The old order `80CM9MTRVQ7C4` is never touched.

### Official references
- Atomic order (checkout preview, create, pay): https://docs.clover.com/dev/docs/create-an-atomic-order
- Pay for an order (Ecommerce): https://docs.clover.com/dev/reference/postordersidpay
- Why the Platform payments POST is wrong for this: https://docs.clover.com/dev/reference/ordercreatepaymentfororder
- Card token: https://docs.clover.com/dev/docs/create-a-card-token
- Public key / PAKMS key: https://docs.clover.com/dev/docs/generate-ecommerce-api-key-or-pakms-key
- Test cards: https://docs.clover.com/dev/docs/test-card-numbers
- Merchant test API token: https://docs.clover.com/dev/docs/create-an-api-token

### What the docs establish, and what they do not
Established:
- Preview: `POST https://apisandbox.dev.clover.com/v3/merchants/{mId}/atomic_order/checkouts` with headers `accept`, `content-type: application/json`, `authorization: Bearer <Platform test API token>`. Body `{"orderCart":{"lineItems":[{"item":{"id":"<catalog item id>"}}]}}`. Creates nothing.
- Create: `POST .../atomic_order/orders`, same headers and body plus `orderType.id` inside `orderCart`. Creates an unpaid order (`ORD...`); the order type comes from the merchant's order types.
- Tokenize: `POST https://token-sandbox.dev.clover.com/v1/tokens`, headers `accept`, `content-type`, and `apikey` = the **public** Ecommerce key. Body `{"card":{"number","exp_month","exp_year","cvv","last4","first6","brand"}}`. Returns `clv_...`. No Authorization header is used here.
- Pay: `POST https://scl-sandbox.dev.clover.com/v1/orders/{orderId}/pay`, headers `User-Agent` and `x-forwarded-for` required. Body fields include `source` (the `clv_` token), `amount` (cents), `ecomind`, `metadata`; unlisted fields are rejected. The Clover key page states the Ecommerce **private** key is the Bearer token for Ecommerce APIs and the public key is the tokenization key. Response is an order object with `status` (`paid` expected).
- Sandbox card `4242 4242 4242 4242`: any future expiry, any 3-digit CVV. Amounts under $100.00 are approved. $45.67 returns "No Host Response".

Not established (stop conditions below cover these):
- The pay reference lists `customer` as required in its schema but its description says `source` **or** `customer`. We send `source`. HTTP 400 naming `customer` or `email` is a stop, not a cue to improvise.
- The docs do not show a pay response sample or confirm that `paymentState` becomes `PAID` on the Platform order. Stage 5 verifies it; nothing is assumed.
- The atomic-order docs do not say whether the merchant's tax is applied. Stage 1 shows the real total.
- Whether the Platform test token also works as the `/pay` Bearer is undocumented. Use the Ecommerce private key.

### Credentials (owner-held; the only ones needed)
1. **Platform sandbox test API token** for `V7SXJVSGY5051` (the same kind the GET scripts used). Stages 0, 1, 2, 5.
2. **Ecommerce public and private keys** for the same sandbox merchant: Sandbox dashboard, Setup, Ecommerce API Tokens, create a token pair. Public is the `apikey` in stage 3; private is the Bearer in stage 4. If the dashboard stays unreliable, the alternative for the public key is `GET https://scl-sandbox.dev.clover.com/pakms/apikey` with an OAuth access token; the private key has no API alternative. **If the dashboard cannot produce the pair, that is the blocker.** The smallest next step is then a Sandbox Register or device sale (see end of section), which needs no Ecommerce keys.
3. The operator's public-facing IPv4 address for `x-forwarded-for` (any valid IP the owner is willing to supply; typed at the prompt).
4. For stage 6 only: a Flowtally owner or setup-staff login, the API base URL, and the organization and location ids from the section 3 SQL. These are not Clover credentials.

Never paste a token, key, `clv_` token, card number or password into GitHub, chat or a file. The scripts read secrets with hidden prompts and keep only non-secret ids in `%USERPROFILE%\clover166\state.json`.

### Shared header (paste at the top of every stage)
```powershell
$ErrorActionPreference = "Stop"
$Mid    = "V7SXJVSGY5051"
$ItemId = "TE0BYZH7B28AJ"          # CATALOG item id. Never 2J0331CFQ9JPW, which was the old order's LINE-ITEM id.
$Plat   = "https://apisandbox.dev.clover.com"
$Ecom   = "https://scl-sandbox.dev.clover.com"
$Tok    = "https://token-sandbox.dev.clover.com"
$Dir    = Join-Path $env:USERPROFILE "clover166"; New-Item -ItemType Directory -Force $Dir | Out-Null
$StateF = Join-Path $Dir "state.json"
$State  = if (Test-Path $StateF) { Get-Content $StateF -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
function Save-State($k,$v){ $State | Add-Member -NotePropertyName $k -NotePropertyValue $v -Force; $State | ConvertTo-Json | Set-Content $StateF }
function Read-Secret($prompt){ $s = Read-Host $prompt -AsSecureString; $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) } }
function Show-Err($e){ $c = if ($e.Exception.Response) { [int]$e.Exception.Response.StatusCode } else { "no response" }
  Write-Host "FAILED: HTTP $c"; $m = "$($e.ErrorDetails.Message)"; if ($m) { Write-Host $m.Substring(0,[Math]::Min(400,$m.Length)) } }
function Plat-Get($path,$tok){ Invoke-RestMethod -Method Get -Uri "$Plat$path" -Headers @{Authorization="Bearer $tok";Accept="application/json"} -TimeoutSec 30 }
function Plat-Post($path,$tok,$obj){ Invoke-RestMethod -Method Post -Uri "$Plat$path" -ContentType "application/json" -Headers @{Authorization="Bearer $tok";Accept="application/json"} -Body ($obj | ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 30 }
```

### Stage 0. Read-only discovery (GET only; no authorization beyond "read-only OK")
```powershell
# (paste shared header first)
$plat = Read-Secret "Platform sandbox API token"
try {
  $m  = Plat-Get "/v3/merchants/$Mid" $plat
  $it = Plat-Get "/v3/merchants/$Mid/items/$($ItemId)?expand=taxRates" $plat
  $ot = Plat-Get "/v3/merchants/$Mid/order_types" $plat
  "== Merchant =="; $m | Select-Object id, name | Format-List
  "== Catalog item =="; $it | Select-Object id, name, price, hidden, deleted, @{n="taxRates";e={@($_.taxRates.elements).Count}} | Format-List
  "== Order types =="; $ot.elements | Select-Object id, label, isDefault | Format-Table -AutoSize
  if ($m.id -ne $Mid) { throw "STOP: wrong merchant" }
  if ($it.id -ne $ItemId -or $it.hidden -or $it.deleted) { throw "STOP: catalog item missing, hidden or deleted" }
} catch { Show-Err $_; throw } finally { Remove-Variable plat -ErrorAction SilentlyContinue }
```
Expected: merchant `V7SXJVSGY5051`, item `TE0BYZH7B28AJ` named Test Burger, price 1800, not hidden or deleted. Pick **one** order type id (prefer the default). Record `taxRates` count: a non-zero count means the total will exceed 1800. Then run:
```powershell
$OrderTypeId = Read-Host "Order type id chosen from the table"; Save-State orderTypeId $OrderTypeId
```
**Stop if** the item is hidden, deleted or absent, or no order type is returned.

### Stage 1. AUTHORIZATION GATE G0a: checkout preview (POST; creates nothing)
```powershell
# (shared header first)
$plat = Read-Secret "Platform sandbox API token"
try {
  $body = @{ orderCart = @{ lineItems = @(@{ item = @{ id = $ItemId } }) } }
  $pv = Plat-Post "/v3/merchants/$Mid/atomic_order/checkouts" $plat $body
  $pv | ConvertTo-Json -Depth 8
  $line = @($pv.orderCart.lineItems)
  if ($line.Count -ne 1 -or $line[0].item.id -ne $ItemId) { throw "STOP: preview does not contain exactly one TE0BYZH7B28AJ line" }
} catch { Show-Err $_; throw } finally { Remove-Variable plat -ErrorAction SilentlyContinue }
```
Expected: HTTP 200, a checkout `id` starting `CHK`, exactly one line with `item.id=TE0BYZH7B28AJ`, price 1800. Read any total or tax shown and write the expected order total in cents down. If the preview shows no total, proceed to stage 2 and read the total there. **Stop if** more than one line, any modification or discount appears, or the item id differs.

### Stage 2. AUTHORIZATION GATE G0b: create the unpaid order (POST; creates ONE order; never run twice)
```powershell
# (shared header first)
if ($State.orderId) { throw "STOP: an order is already recorded ($($State.orderId)). Do not create another." }
$plat = Read-Secret "Platform sandbox API token"
try {
  $body = @{ orderCart = @{ lineItems = @(@{ item = @{ id = $ItemId } }); orderType = @{ id = $State.orderTypeId } } }
  $o = Plat-Post "/v3/merchants/$Mid/atomic_order/orders" $plat $body
  Save-State orderId $o.id
  $g = Plat-Get "/v3/merchants/$Mid/orders/$($o.id)?expand=lineItems" $plat
  "== New order =="; $g | Select-Object id, state, paymentState, total, unpaidBalance, currency | Format-List
  Save-State expectedTotal $g.total
} catch { Show-Err $_; throw } finally { Remove-Variable plat -ErrorAction SilentlyContinue }
```
Expected: HTTP 200 on create, id starting `ORD`, GET shows `paymentState` of `OPEN` (unpaid is correct at this point), `total` = 1800 plus any tax, no payments. Record the order id and total. **Stop if** the total is not what stage 1 or the item price implies, or the create response lacks an id. Do not retry a create that errors: first look at the dashboard Orders list or `GET /orders?orderBy=createdTime DESC&limit=5` to see whether it was created.

### Stage 3. AUTHORIZATION GATE G0c: tokenize the Sandbox test card (POST; no charge)
```powershell
# (shared header first)
$pub = Read-Secret "Ecommerce PUBLIC key"
try {
  $card = @{ card = @{ number="4242424242424242"; exp_month="12"; exp_year="2035"; cvv="123"; first6="424242"; last4="4242"; brand="VISA" } }
  $t = Invoke-RestMethod -Method Post -Uri "$Tok/v1/tokens" -ContentType "application/json" -Headers @{ apikey=$pub; Accept="application/json" } -Body ($card | ConvertTo-Json -Compress) -TimeoutSec 30
  if (-not $t.id -or -not $t.id.StartsWith("clv_")) { throw "STOP: no clv_ token returned" }
  $global:CloverCardToken = $t.id; "Token obtained (not displayed); last4=$($t.card.last4) brand=$($t.card.brand)"
} catch { Show-Err $_; throw } finally { Remove-Variable pub,card -ErrorAction SilentlyContinue }
```
Expected: HTTP 200, id `clv_...`, `last4=4242`. The token stays only in this window's memory. Run stage 4 in the **same window**; if you close it, repeat stage 3 (harmless). **Stop if** HTTP 401 or 403 (wrong or inactive public key; the key must be for this merchant), or HTTP 400 on `brand` (the docs do not list allowed brand values; `VISA` is the natural value, report the error body rather than guessing).

### Stage 4. AUTHORIZATION GATE G0d: pay the order, once (POST; the only step that charges the Sandbox card)
```powershell
# (shared header first; same window as stage 3)
if (-not $global:CloverCardToken) { throw "STOP: run stage 3 in this window first" }
if (-not $State.orderId) { throw "STOP: no order recorded" }
if ($State.paidAttempted) { throw "STOP: a pay attempt was already made. Run stage 5 instead; never retry blindly." }
$ip = Read-Host "Operator IPv4 address for x-forwarded-for"
$priv = Read-Secret "Ecommerce PRIVATE key"
Save-State paidAttempted $true
try {
  $b = @{ source = $global:CloverCardToken; ecomind = "ecom"; metadata = @{ delete_order_on_failure = "true" } }
  $r = Invoke-RestMethod -Method Post -Uri "$Ecom/v1/orders/$($State.orderId)/pay" -ContentType "application/json" -TimeoutSec 60 `
       -Headers @{ Authorization="Bearer $priv"; Accept="application/json"; "x-forwarded-for"=$ip; "User-Agent"="FlowtallyOwnerAcceptance/1.0" } `
       -Body ($b | ConvertTo-Json -Depth 5 -Compress)
  "== Pay response =="; $r | Select-Object id, status, amount, amount_paid, amount_due | Format-List
} catch { Show-Err $_; Write-Host "DO NOT RERUN STAGE 4. Run stage 5 to learn the real state."; throw }
finally { Remove-Variable priv,ip,b -ErrorAction SilentlyContinue; Remove-Variable CloverCardToken -Scope Global -ErrorAction SilentlyContinue }
```
Expected: HTTP 200, `status=paid`, `amount_due=0` (or absent). This is **not yet proof**: stage 5 decides. **Stop on** HTTP 400 mentioning `customer` or `email`, 401, 403, a `declined` response, or a timeout; then run stage 5 only (a timeout can still have charged) and report. Do not try the Platform `/orders/{id}/payments` endpoint as a fallback.

### Stage 5. Read-only verification: what a truly PAID order looks like
```powershell
# (shared header first)
$plat = Read-Secret "Platform sandbox API token"
$OrderId = $State.orderId
try {
  $o   = Plat-Get "/v3/merchants/$Mid/orders/$($OrderId)?expand=lineItems,payments,refunds" $plat
  $li  = Plat-Get "/v3/merchants/$Mid/orders/$OrderId/line_items?limit=100&expand=modifications" $plat
  $pay = Plat-Get "/v3/merchants/$Mid/orders/$OrderId/payments?limit=100&expand=refunds" $plat
  "== Order =="; $o | Select-Object id, state, paymentState, total, unpaidBalance, currency, @{n="deleted";e={[bool]$_.deletedTime}} | Format-List
  "== Line items =="; $li.elements | Select-Object id, @{n="catalogItemId";e={$_.item.id}}, name, price, @{n="mods";e={@($_.modifications.elements).Count}} | Format-Table -AutoSize
  "== Payments =="; $pay.elements | Select-Object id, result, amount, tipAmount, taxAmount, @{n="refundsReturned";e={ $null -ne $_.refunds }}, @{n="refundCount";e={@($_.refunds.elements).Count}} | Format-Table -AutoSize
  $ok = @($pay.elements | Where-Object { $_.result -eq "SUCCESS" } | Measure-Object -Property amount -Sum).Sum
  $c = [ordered]@{
    "paymentState is PAID"                    = ($o.paymentState -eq "PAID")
    "one SUCCESS payment, sum = total"       = (@($pay.elements).Count -eq 1 -and $ok -eq $o.total)
    "unpaidBalance null or 0"                = (($null -eq $o.unpaidBalance) -or ($o.unpaidBalance -le 0))
    "refund data RETURNED and empty"         = (($pay.elements | Where-Object { $null -eq $_.refunds }).Count -eq 0 -and @($pay.elements.refunds.elements).Count -eq 0)
    "exactly one line, catalog item TE0BYZH7B28AJ" = (@($li.elements).Count -eq 1 -and $li.elements[0].item.id -eq $ItemId)
    "no modifications"                       = -not ($li.elements | Where-Object { @($_.modifications.elements).Count -gt 0 })
    "not deleted"                            = -not $o.deletedTime
  }
  $c.GetEnumerator() | ForEach-Object { "{0,-48} {1}" -f $_.Key, $_.Value }
  if ($c.Values -notcontains $false) { "VERDICT: truly PAID and eligible-shaped" } else { "VERDICT: NOT eligible. Record the false rows; change nothing." }
  if ($c.Values -notcontains $false) { Save-State verifiedPaid $true; Save-State paymentId $pay.elements[0].id }
} catch { Show-Err $_; throw } finally { Remove-Variable plat -ErrorAction SilentlyContinue }
```
**A truly PAID order** has, together: `paymentState=PAID` on the **order**, exactly one `SUCCESS` payment whose amount equals the order total, no unpaid balance, refund data actually returned and empty (a missing `refunds` field is "unknown", not "none"; if `expand=refunds` errors with 400, the order is not acceptable evidence until refund data is returned), one line whose `item.id` is the catalog id `TE0BYZH7B28AJ`, and no modifications. A `SUCCESS` payment on an order with `paymentState=OPEN` is exactly the `80CM9MTRVQ7C4` shape and is **not** paid. If it recurs on a normally paid order, stop: that is a provider-compatibility blocker for a new issue, not a reason to loosen `classify_order`. Tip and tax: a taxed total is accepted for the first application; `refundKind` will later read `unknown`.

### Stage 6. Credential cleanup (run after stage 5, or after any abort)
```powershell
Remove-Variable plat,pub,priv,ip,card,t,r,CloverCardToken -Scope Global -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\clover166\state.json" -ErrorAction SilentlyContinue   # keep only if you still need the order id; the id is not a secret
Clear-History; (Get-PSReadLineOption).HistorySavePath | ForEach-Object { if (Test-Path $_) { Select-String -Path $_ -Pattern "clv_|Bearer|apikey" -SimpleMatch -Quiet } }
```
If the last line prints `True`, delete that history file. Because keys were typed at hidden prompts they should not be in history; if a key was ever typed in clear text, rotate the Ecommerce token pair in the Sandbox dashboard.

### Can this be done with the owner's existing credentials?
- **Yes for stages 0, 1, 2, 5:** the Platform sandbox test API token already used for the GET evidence. The merchant/item/order-type reads and the order create need the token to have Orders and Inventory read-write permission; a 401 or 403 on stage 1 or 2 means the test token's permissions must be widened in the Sandbox dashboard (smallest step: regenerate the test API token with Orders and Inventory write).
- **Unknown for stages 3 and 4:** no Ecommerce public/private key pair has been mentioned as existing. If the pair does not exist and the dashboard stays unreliable, the **single missing credential** is the Ecommerce key pair, and the smallest practical next step is the Register route: create the same single-item sale through the Sandbox Web Register or a Sandbox device with the test card, pay, then run stage 5. That uses no Ecommerce keys. Either route ends at stage 5.
- Not supported: marking `80CM9MTRVQ7C4` paid, or using the Platform payments POST. Neither will be attempted.

### Stage 7. Flowtally dry run (Flowtally write: shadow rows). AUTHORIZATION GATE G1 + G2
Preconditions: the #165 evidence is recorded; the section 4 allowlist contains only the Showcase organization; SQL baseline and hand-computed deductions are written down; the owner has set **only** `CLOVER_ORDER_SHADOW_ENABLED=true` (G1) and then `CLOVER_ORDER_INVENTORY_ENABLED=true` (G2) in Render. The Fetch button in the app sends no window and no `executeInventory` field, so the dry run and the execution need the API directly. The default window is the last 7 days by `modifiedTime`.
```powershell
# (shared header first)
$Api   = Read-Host "Flowtally API base URL (https://...)"
$OrgId = [int](Read-Host "organizationId (from the section 3 SQL)"); $LocId = [int](Read-Host "locationId")
$Start = (Get-Date).AddHours(-2).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")   # shortly before the order was created
$End   = (Get-Date).AddMinutes(10).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$web = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$email = Read-Host "Flowtally owner email"; $pw = Read-Secret "Flowtally password"
try {
  $c = Invoke-RestMethod -Uri "$Api/api/auth/csrf" -WebSession $web
  Invoke-RestMethod -Method Post -Uri "$Api/api/auth/login" -WebSession $web -ContentType "application/json" -Headers @{"X-CSRFToken"=$c.csrfToken} -Body (@{email=$email;password=$pw}|ConvertTo-Json -Compress) | Out-Null
  $c = Invoke-RestMethod -Uri "$Api/api/auth/csrf" -WebSession $web
  $body = @{ organizationId=$OrgId; locationId=$LocId; startDate=$Start; endDate=$End; dryRun=$true; executeInventory=$true } | ConvertTo-Json -Compress
  $res = Invoke-RestMethod -Method Post -Uri "$Api/api/integrations/clover/shadow-orders/fetch" -WebSession $web -ContentType "application/json" -Headers @{"X-CSRFToken"=$c.csrfToken} -Body $body
  $res.inventoryAutomation | ConvertTo-Json -Depth 8
  $res.orders | Select-Object cloverOrderId, status, paymentStateConflict, totalCents | Format-Table -AutoSize
} catch { Show-Err $_; throw } finally { Remove-Variable pw,email -ErrorAction SilentlyContinue }
```
Login is rate-limited to 5 per minute; the app's own cookie flow is the same. Expected response (`backend/clover_integration.py` fetch route): `readOnly` and `previewOnly` **true** (dry run), `inventoryAutomation.enabled=true`, `dryRun=true`, and `results` containing exactly one entry, for the new order id, with `eligible: true`, `reason: ""`, `applied: false`, and `movements` with one entry per ingredient whose quantity equals the hand computation `sale_qty x quantity_required / yield`, quantized to 0.0001, each with `state: "new"`. The order row shows a paid status and `paymentStateConflict: false`. **Stop if** `results` lists any other order id, `eligible` is false (record `reason`; the known reasons are `order_not_financially_verified`, `financial_or_line_data_incomplete`, `line_mapping_or_recipe_missing`, `invalid_recipe_ingredient`, `invalid_recipe_quantity`, `ingredient_unit_conflict`), or any quantity differs from the hand computation by even 0.0001. Confirm via SQL that no new `inventory_movements` rows exist.

Variant to confirm the old order stays blocked: the same call with a window around the old order's `modifiedTime` (`1793399282000` ms) must show `80CM9MTRVQ7C4` as `review`, `paymentStateConflict: true`, `eligible: false`, with zero movements.

### Stage 8. AUTHORIZATION GATE G3: one execute, then G4 replay
Same script with `dryRun=$false` and `executeInventory=$true` (JSON boolean true; any other value only previews). Expected: `previewOnly=false`, one result with `applied: true`, movements `state: "new"`; in SQL one `clover sale consumption` movement per ingredient, `source_record_id` = the order id, on-hand = baseline minus hand-computed quantity, one consumption row per ingredient with the cost snapshot equal to `average_unit_cost`. **Replay (G4, authorized in advance with G3):** run the identical request twice more. Expected: results show movements `state: "unchanged"`, `applied` with zero new rows, on-hand unchanged, ledger delta zero. **Stop** on any second movement or any on-hand change.

### Stage 9. Reconciliation and reports (read-only)
Per ingredient: opening on-hand minus Clover movements equals closing on-hand, and the movement ledger sums to on-hand. Square movements and Square Daily Close are unchanged. Clover rows are excluded from count-variance and "other adjustments" because their source type is in the POS sale set. Confirm the audit event `clover.shadow_orders.ingested` shows `inventoryAutomation: true` for the execute run only. Daily Close (Clover): the new sale's net sales appear for the order's date, with a card tender, so Clover cash-tender expected cash is unchanged; the Square figures are unchanged. Menu costing and the Clover usage report show the burger's recipe consumption at the cost snapshots. Compare to the stage 0 baseline figures; record exact before and after values on #166. Do not accept "looks plausible".

### Stage 10. AUTHORIZATION GATE G5: restore flags to OFF
Owner sets `CLOVER_ORDER_INVENTORY_ENABLED` back to false or removes it, then `CLOVER_ORDER_SHADOW_ENABLED` back to false. Screenshot the Render env names and on/off values only. `/api/health` ok. Re-run the dry-run call: expected HTTP 404 `clover_shadow_orders_disabled` with shadow off. With only shadow on (an optional intermediate check), a request with `executeInventory=true` stays preview-only. Record the final flag values on #166 and #165.

### Refund, void and removed-line obligations (required for the full MVP; not downgraded here)
| Case | Automated evidence | Genuine Sandbox evidence |
|---|---|---|
| Paid sale applied once, replay, ledger reconciliation | `test_clover_inventory.py`, PostgreSQL/RLS tests; enabled-path tests | **Still required**: stages 0-10 above |
| Old order `OPEN` with `SUCCESS` payment stays blocked | `test_clover_orders.py` (same payment id) | Stage 7 variant, read-only |
| Full refund after application | `test_refund_kind_is_authoritative_or_unknown`, `test_refund_kind_status_versus_records_decision_table`, `test_normalized_refunded_order_with_empty_refund_collection_is_unknown_not_none` | **Still required**: refund the new paid order in Sandbox (needs separate authorization, below), re-fetch, expect `appliedRequiresReview`, `refundKind` of `full` or `unknown`, stock **unchanged** |
| Partial refund | refund-kind tests above | **Still required**: use a second, separate paid order of 2 units or a second item so the first remains a clean baseline |
| Void or delete an unpaid order | `test_cancelled_deleted_and_unknown_orders_are_not_eligible` | **Still required**: create a second unpaid order (stage 2) and delete or void it; expect not eligible, zero movements |
| Line removed after application | `test_removed_applied_line_is_flagged_and_stock_never_changes` | **Still required**: this needs an order that was already applied; a removal of a line on a paid order may not be possible in Clover. If Clover disallows it, record that as the provider's unsupported operation with the response, and ask the owner to confirm the automated evidence stands for that single case. That is the owner's decision, not mine |
| Refund data unavailable (merchant refunds filter returns 400) | `test_merchant_refunds_400_is_handled_as_unverified_financial_data`, `test_paid_order_with_unverified_refunds_remains_ineligible` | Stage 5 requires returned refund data; nothing further |

Each Sandbox refund or void is a Clover write and needs its own explicit authorization; the stage scripts above do not contain them. The refund call, its endpoint and required fields are **not yet verified** against current docs; I will verify them and add a staged script as soon as the first paid order passes stage 5, rather than guess now. Stock is never restored automatically; any correction goes through the existing adjustment flow.

### Authorization boundaries (summary)
| Gate | Action | Class |
|---|---|---|
| none | Stages 0, 5, 9 and SQL | Read-only |
| G0a-G0d | Stages 1-4: preview, create, tokenize, pay | Clover Sandbox writes, one approval per stage |
| G1 | `CLOVER_ORDER_SHADOW_ENABLED=true` and the stage 7 dry run | Render config change and Flowtally DB write |
| G2 | `CLOVER_ORDER_INVENTORY_ENABLED=true` | Render config change |
| G3, G4 | Execute once, replay twice | Flowtally inventory write |
| G5 | Flags back to off | Render config change |
| G6+ | Sandbox refund, partial refund, void | Clover Sandbox writes, separate approvals |
Agents run none of the gated items.

