# Flowtally Showcase Recording Plan

## Capture rules

Record only the existing private production showcase state. Do not log in on camera, upload, save, receive, adjust, count, sync, create an order, change a mapping, or start a close. Wait for data to finish loading before each shot. Square is connected in Production; show only the existing controlled Oct 2 test order and its persisted Usage / Variance and Inventory History evidence.

## 60–90 second product highlight

| Time | Route/page | Exact shot | Narration / transition |
|---|---|---|---|
| 0–10s | Dashboard | Hold on the attention panel and headline metrics. | “Flowtally gives the owner one operational view of purchases, inventory, costs, and actions.” Cut to Purchases.
| 10–25s | Purchases | Open completed `OV-1041`; hold on supplier, Chicken Breast, $7.80, and completed/read-only state. | “Supplier purchasing becomes structured review evidence instead of another disconnected invoice.” Cut to Inventory.
| 25–35s | Inventory → Chicken Breast | Hold on 3.1kg, minimum 4, PAR 8, latest $7.80, Reorder now. | “The reviewed purchase is connected to the stock picture.” Open History → Movements.
| 35–45s | Inventory History | Hold on the two invoice receipts and the persisted Square-order consumption movement. | “The record preserves what changed and why.” Cut to Menu Costing.
| 45–60s | Menu Costing → Recipes | Open Harbour Burger and hold on $2.21 cost plus three ingredient lines. | “A menu item makes expected ingredient usage understandable.” Cut to Usage / Variance.
| 60–75s | Usage / Variance | Hold on `Harbour Burger · Base`, Harbour Burger mapping, one sold unit, and theoretical usage. | “This controlled Production test order is mapped to a recipe and translated into theoretical ingredient usage.” Cut to Reorder Plan.
| 75–90s | Reorder Plan | Hold on Chicken Breast and Eggs recommendations. | “Flowtally turns the operational signal into the owner’s next action.” End on Dashboard branding.

Final frame: `Purchases → Inventory → Recipes → Sales Usage → Action`.

## 3–5 minute shot list

### Shot 1 — Owner overview, 20–30s

- Route: `/app/dashboard`
- Object: Dashboard attention panel
- Visible: 15 reorder items, 2 invoices to review, 8 price changes, 16 actions, and current month-to-date spend.
- Cursor: Move once from metrics to the Reorder pressure card.
- Narration: “The owner starts with what needs attention, not a raw data dump.”
- Transition: Click Purchases in the sidebar.

### Shot 2 — Completed purchase review, 30–45s

- Route: `/app/purchases`
- Object: `OV-1041`, Oak Valley Meat Co
- Visible: Completed/read-only purchase, Chicken Breast 1kg, $7.80, $8.81 total, source PDF, 92% mapping confidence.
- Cursor: Open the existing record; do not click edit, save, receive, upload, or create.
- Narration: “This is the purchase review record. Its current extraction status is manual, so this is not presented as a live OCR capture.”
- Transition: Close the record and open Inventory.

### Shot 3 — Inventory position, 25–35s

- Route: `/app/inventory`
- Object: Chicken Breast
- Visible: 3.1kg on hand, minimum 4kg, PAR 8kg, average $7.63, latest $7.80, Reorder now.
- Cursor: Open the item once.
- Narration: “The purchase evidence and current stock position are visible together.”
- Transition: Select History → Movements.

### Shot 4 — Inventory movement history, 25–35s

- Route: Inventory item dialog → History → Movements
- Object: Chicken Breast movement table
- Visible: OV-1041 receipt +1kg, OV-1038 receipt +1kg, persisted Square order `Umhs2cLYmUVXyhU9cS8GyOfxu3LZY` consumption -0.2kg.
- Cursor: Rest over the movement rows; no action controls.
- Narration: “The audit trail shows receipts and the persisted historical consumption event.”
- Transition: Close and open Menu Costing.

### Shot 5 — Recipe and cost, 30–45s

- Route: `/app/menu-costing` → Recipes
- Object: Harbour Burger
- Visible: $2.21 recipe cost, 1 serving, Chicken Breast 0.2kg, Bread Buns 0.3 pack, Lettuce 0.1 head.
- Cursor: Open Harbour Burger; do not update or delete.
- Narration: “The recipe turns a menu item into a concrete ingredient and cost model.”
- Transition: Close and open Usage / Variance.

### Shot 6 — Usage traceability, 35–45s

- Route: `/app/square-usage`
- Object: Existing mapping and selected Harbour Kitchen usage window
- Visible: `Harbour Burger · Base` mapped to Harbour Burger, one sold unit, 100% coverage, theoretical usage 0.18kg / 0.25 pack / 0.12 head.
- Cursor: Rest over mapping and theoretical-usage table.
- Narration: “This is the persisted sales-to-recipe trace from the controlled Production test order; we do not create another transaction during the showcase.”
- Transition: Open Reorder Plan.

### Shot 7 — Owner action, 25–35s

- Route: `/app/reorder-plan`
- Object: Chicken Breast and Eggs rows
- Visible: Chicken Breast 4.9kg suggested / $36.66; Eggs 3 dozen / $17.70 / Out of stock.
- Cursor: Do not click Add to draft.
- Narration: “The final step is action: what to buy and why.”
- Transition: Return to Dashboard for close.

## What to omit

Do not record the login screen, internal setup/admin screens, connection controls, blank Daily Close, Reporting, account menus, browser clutter, or loading states. Stock Counts is optional only if its completed history is loaded. If a page is slow, hold until it is complete or cut to the next verified shot.

## Recording status

Persistent video was not created. The available browser bridge supports in-session screenshots but does not expose a persistent video recorder or a permitted file-write path from the browser process. Use the shot list above for a clean manual or future recorder pass.
