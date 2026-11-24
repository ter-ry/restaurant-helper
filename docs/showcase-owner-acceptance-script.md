# Showcase owner acceptance script (#169)

Owner-supervised manual walkthrough of the full MVP journey on **Showcase** (never Production customer data). It complements `docs/showcase-runbook.md` (the sales story) and `docs/square-showcase-sales-runbook.md`; this file is the **evidence checklist**. Automated browser tests use mocks, so nothing here is covered by them as live acceptance.

**Rules.** Every mutation below is performed by the owner (or an owner-supervised session) on Showcase only. No Clover inventory flag, no real payment, no migration, no reseed. If any STOP condition fires, stop, capture it, file an issue, and do not continue to later sections that depend on it.

## 0. Preflight (record once)

| Record | Value |
|---|---|
| Date, observer, device + browser | |
| Showcase frontend SHA / backend SHA / Alembic head (#165) | |
| Tenant + location (expect Flowtally Showcase / Harbour Kitchen) | |
| Signed-in role (expect owner; repeat §8 as manager/staff) | |

STOP if the environment or tenant is not Showcase, or the SHA is unknown. Screenshot the login-landed `/app/dashboard`.

## 1. Dashboard baseline

Open `/app/dashboard`. Record: sales/collected figure and its date range label, order count, purchases total, urgent vs running-low reorder counts, any "Unavailable" tiles.

- PASS: every figure shows a number or the word **Unavailable** with a reason; date range is labelled.
- FAIL/STOP: any tile shows `$0` where the source is unavailable; purchase status disagrees with Purchases (§2) after you complete it.

## 2. Purchases / OCR (`/app/purchases`)

Use one disposable supplier and a printed invoice with a known total (e.g. five-line catering invoice, $106.50).

| Step | Expect | Record |
|---|---|---|
| New purchase → upload image | Full-width editor: original document left, editable lines right; extracted lines + total | Screenshot at 1440px; extracted total vs printed total |
| Remove or alter one line so lines ≠ printed total | Banner **Extraction looks incomplete** with the difference; **Save & receive** disabled | Screenshot of banner and the disabled button |
| Edit the totals fields only | Warning stays (totals edits do not clear it) | Yes/No |
| Save draft → hard refresh → reopen the draft | Banner and block reappear from server evidence; lines intact | Screenshot after reload |
| With lines unmapped | Button text **Map N items to inventory before receiving**; receiving blocked | Screenshot |
| Map all lines; try receive while still discrepant | Still blocked (Extracted items do not match the printed invoice) | Screenshot |
| Correct lines to match (or **Add missing line**) → **Extracted items match the invoice** → **Save & receive** → confirm | Success message; invoice shows Received once | Invoice number, time |
| Double-click confirm / refresh and retry receive | No second posting; on-hand changes once | Inventory delta (§3) |
| **Before voiding:** do §3 on-hand/cost check and §5 recipe-cost propagation check while the receipt is still active | See §3 and §5 | Figures recorded while received |
| Void or correct the received invoice (last step) | Status Voided / correction draft; on-hand, average cost and recipe cost return to their pre-receipt values | Before/after on-hand, cost |
| (Optional) **Record audited override** with a ≥10 character reason | Override recorded with name; needs saved draft | Reason text |

STOP if: receive succeeds while the banner says incomplete without an override; on-hand changes twice; a refusal is silent (no visible error); totals shown as `$0` instead of unknown.

## 3. Inventory, count, waste, PAR (`/app/inventory`)

Pick one mapped item (e.g. Chicken Breast). Record on-hand, average cost, value **before** §2.

| Action | Expect | Record |
|---|---|---|
| After receive (§2) | On-hand up by received qty; weighted-average cost moved consistently with the invoice price; value ≈ on-hand × average | Arithmetic: on-hand × avg vs displayed value (rounding only) |
| After void/correction | On-hand and value return to prior (or corrected) figures | Before/after |
| Waste entry (**Record waste**) | Pending state, success message, list refreshes without reload, on-hand drops by that qty | Screenshot |
| Stock count: start → enter counted qty → complete | Variance shown; completed session listed; on-hand matches the count after approval | Counted vs system qty |
| Reload the page | All of the above persists (server state, not browser state) | Yes/No |
| Reorder plan | Item at/below PAR appears under urgent / running low; counts match Dashboard split | Compare with §1 |

STOP if: any quantity or value differs from your arithmetic by more than rounding; a mutation shows no progress/result state; stale numbers remain after a reload.

## 4. Square usage

Open the Square page and usage view (`/app/square`, usage tab). Record: connection state and freshness, location mapping, mapped menu items, theoretical vs physical usage and **coverage** (e.g. 1/3).

- PASS: low coverage is labelled indicative; unmapped items are listed, not silently ignored.
- STOP: connection shown as current when it is not; usage `0` with no mapping/coverage explanation.

## 5. Menu costing (`/app/menu-costing`)

Open one recipe (e.g. Harbour Burger: price $18, cost $2.37 → food cost 13.2%). Record ingredient costs, total, price, food-cost %.

- Record the recipe baseline **before** the §2 receive, then check again after the receive while it is still active (before the void).
- PASS: food-cost % = cost ÷ price (check by hand); an ingredient without cost shows **Cost unavailable**, never `$0`; while the receipt is active, a cost-changing receive flows into the recipe cost. After the void the cost correctly returns to the baseline (weighted average is restored), which is not a failure.
- STOP: unavailable cost displayed as `$0.00`; recipe cost unchanged after a cost-changing receive and reload while the receipt is active.

## 6. Daily Close (`/app/daily-close`)

Open a business date with known Square data. Record net sales, orders, tips, tax, food cost %, cash/expected cash, variance.

- PASS: when expected cash cannot be verified, variance shows **Variance unavailable** with a reason (not `$0`); sales that Square cannot supply show **Unavailable**.
- Cross-check: net sales equals the same date in the dated Daily report (§7a); include the Dashboard "Today" figure only when the selected date is today (it has no date selector).
- STOP: variance or sales `$0` while the source is unavailable; totals differ between pages for the same date.

## 7. Dated sales reporting and Owner Reports

**7a. Dated sales (`/app/dashboard?view=daily`, the Daily report).** Select the same business date as §6. Record net sales, orders and food-cost figures.

- PASS: figures match Daily Close (§6) for that date (and the Dashboard only if that date is today); unavailable data shows **Unavailable**, not `$0`.
- STOP: totals differ between pages for the same date; unlabeled date range.

**7b. Owner Reports (`/owner/reports`, owner only).** This page shows weekly invoice spend, export readiness and audit summaries, not dated sales. Record the purchases total and date-range label, then export once and open the file.

- PASS: the purchases figure agrees with the invoices from §2; the export's purchase and audit rows match what the page shows.
- STOP: Reports link visible to non-owner (§8).

## 8. Roles and viewports

- Sign in as manager and staff: owner-only Reports link must be absent; Purchases/Inventory mutating buttons disabled or hidden per role; a 403 explains missing access rather than offering a useless Retry.
- Repeat §2 (editor) and §3 (waste) at **390px, 768px, 1280px+**: no horizontal overflow, no clipped buttons, modals scroll, touch targets usable.
- Toggle light/dark on Dashboard, Purchases, Inventory: text readable.

## 9. Failure behaviour (owner-supervised, once)

With the network throttled offline briefly during a save/receive: the page must show an error, keep your edits, allow retry, and never double-post after reconnect. Record what was displayed.

## 10. Sign-off

For each section record PASS / FAIL / N/A with SHA, date and observer in `docs/RELEASE_STATUS.md` (rows under #169). File every FAIL as an issue with screenshot, route, role, expected vs observed, and the §-number. Do not mark any workflow "verified" from mocked Playwright results; this script is the live evidence.
