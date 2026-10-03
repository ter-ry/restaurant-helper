# Flowtally Production Showcase Runbook

## Status

The production API was rechecked on 2026-10-03 and returned HTTP 200 Flowtally JSON. The frontend and production login loaded, and the existing Flowtally Showcase / Harbour Kitchen account was audited read-only. Square is connected in Production, with one mapped location, one mapped variation, completed sync jobs, and a persisted Oct 2 controlled test order. Daily Close has no session/history and remains out of scope.

## Demo promise

Flowtally is the operating layer between POS activity, supplier invoices, inventory, daily close, and accounting export. It is not a POS replacement, accounting system, or reporting product. Keep the story on three connected controls:

1. purchase review to inventory movement;
2. Square sale to mapped recipe consumption;
3. owner attention to an action loop.

Do not mutate production during the showcase. Do not upload an invoice, create an order, receive stock, or reseed data unless a separately approved rehearsal environment is provided.

## Recommended 10–15 minute sequence

### 0:00–0:30 — orient

Open the private production workspace, select Harbour Kitchen, and show the dashboard. Say: “This is the control layer that turns daily activity into actions an owner can review.” If the dashboard is unavailable, use the one-pager and the prepared screenshots once captured.

### 0:30–4:00 — purchase review to inventory

Open Purchases and use the completed Oak Valley Meat Co invoice `OV-1041` as the rehearsal anchor. Show Chicken Breast 1kg at $7.80, total $8.81, source PDF, 92% mapping confidence, and the read-only completed record. Use `OV-1038` at $7.20 as the price comparison. Label this as a stored purchase/OCR-review record: its extraction status is manual and its raw OCR text is seeded pilot invoice.

Do not upload or save during the live run. Do not call this live OCR. Continue to the existing completed purchase and inventory movement.

### 4:00–6:00 — inventory control

Open Inventory, select Chicken Breast, and show 3.1 kg on hand, minimum 4, PAR 8, latest $7.80, average $7.63, and Reorder now. Open History → Movements: show OV-1041/OV-1038 receipts and the persisted Square order movement of -0.2 kg. Then open Reorder Plan and show the 4.9 kg recommendation at $36.66.

### 6:00–9:30 — Square sale to recipe consumption

Open Menu Costing → Recipes → Harbour Burger first. Show the live $2.21 cost and 0.2 kg Chicken Breast, 0.3 pack Bread Buns, and 0.1 head Lettuce. Then open Usage / Variance: show `Flowtally Test Burger · Base` mapped to Harbour Burger, one sold unit, 100% sales coverage, and theoretical usage. Finally show the Inventory History movement for order `Umhs2cLYmUVXyhU9cS8GyOfxu3LZY`. Call this a controlled Production test order; do not create or sync another order.

### 9:30–12:00 — owner attention loop

Return to Dashboard, show the 16 attention actions and 15 reorder items, then open Reorder Plan. If time permits, show the completed Stock Counts history (#2, total variance -0.5) as an optional proof point. Do not open Daily Close: live audit found no close history or current session.

### 12:00–15:00 — close

Summarize: “The value is the handoff: supplier evidence becomes inventory truth, sales become usage, and exceptions become owner actions.” Ask which control is most painful today. Do not promise Reporting, accounting sync, or a completed live Square/OCR flow unless it was visibly verified.

## Five-minute version

Dashboard (30s) → OV-1041 completed purchase and OV-1038 comparison (1m 30s) → Chicken Breast overview and Movement History (1m) → Harbour Burger recipe and Square Usage / Variance trace (1m 30s) → Reorder Plan (30s) → close (30s).

## Presenter discipline

Pre-open Dashboard, Purchases, Inventory, Square, Menu Costing, Reorder Plan, and this runbook. Use one browser profile, hide unrelated tabs, zoom to a readable level, and keep secrets out of view. If any page is blank or slow, narrate the intended control and move to the documented fallback rather than improvising data.
