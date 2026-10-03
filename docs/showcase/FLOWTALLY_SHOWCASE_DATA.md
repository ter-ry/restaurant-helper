# Flowtally Showcase Data Map

This is the verified live rehearsal map from the Flowtally Showcase / Harbour Kitchen production workspace, rechecked on 2026-10-03. Values can change; read the live screen before presenting them.

## Tenant and location

- Tenant: Harbour Kitchen / Flowtally Showcase
- Location: Harbour Kitchen
- Private pilot routes: `/app/dashboard`, `/app/purchases`, `/app/inventory`, `/app/stock-counts`, `/app/reorder-plan`, `/app/menu-costing`, `/app/square`, `/app/square-usage`, `/app/daily-close`

## Best purchase story

| Invoice | Supplier | Status | Item | Quantity | Unit price |
|---|---|---|---|---:|---:|
| OV-1041 | Oak Valley Meat Co | Completed | Chicken Breast 1kg | 1 kg | $7.80 |
| OV-1038 | Oak Valley Meat Co | Completed | Chicken Breast 1kg | 1 kg | $7.20 |

OV-1041 is the strongest existing purchase proof: total $8.81 including $1.01 tax, received Sep 29 at 2:15 p.m., source `OV-1041.pdf`, mapped to inventory item #24, confidence 92%, and locked read-only in the completed record. Its extraction status is `manual` and raw OCR text is “Seeded pilot invoice”; this is not proof of a live OCR capture. OV-1038 is the price comparison at $7.20 per kg. Draft records NP-6600 ($7.85) and FD-4400 ($24.58) should not be used as completed evidence.

## Live inventory anchors

Chicken Breast is the best anchor: 3.1 kg on hand, minimum 4 kg, PAR 8 kg, average cost $7.63/kg, latest cost $7.80/kg, inventory value $23.80, preferred supplier Oak Valley Meat Co, status Reorder now. Reorder Plan recommends 4.9 kg for an estimated $36.66.

Other verified reorder anchors: Eggs 0/3 dozen, suggested 3 dozen, $17.70, Out of stock; Lettuce 0.4/4 head, suggested 3.6 head, $6.48, Reorder now; Tomato Sauce 1/5 L, suggested 4 L, $25.00, Reorder now; Bread Buns 7.8/14 pack, suggested 6.3 pack, $15.00, Low stock.

Inventory History for Chicken Breast shows invoice receipts of +1 kg from OV-1041 and +1 kg from OV-1038, plus a Square sale consumption of -0.2 kg from order `Umhs2cLYmUVXyhU9cS8GyOfxu3LZY` on Oct 2 at 6:38 p.m.

## Live recipe and menu anchors

- Harbour Burger — $18.00; live cost $2.21, food cost 12.3%, gross profit $15.79. Recipe yield is 1 serving and the active ingredients are Chicken Breast 0.2 kg, Bread Buns 0.3 pack, and Lettuce 0.1 head. Cost basis is average inventory cost: $1.37, $0.62, and $0.22 respectively.
- Chicken Rice Bowl — $17.50; Chicken Breast 0.20kg, Rice 0.16kg, Onions 0.03kg.
- Toronto Breakfast — $15.00; Eggs, Potato, Butter.
- House Salad — $12.00; Lettuce, Tomatoes, Onions.
- Iced Latte — $5.50; Coffee Beans, Milk, Cups.

Seasonal Soup is intentionally a no-recipe example; do not use it to demonstrate automated consumption.

## Square status and strongest available proof

The live Square integration page currently says `disconnected`, last sync `never`, 0 mapped locations, 0 mapped menu items, and 0 daily sales summaries. Do not present it as a currently connected merchant integration.

The strongest existing persisted proof is in Usage / Variance for Harbour Kitchen: sales coverage 100%, one sold unit, mapping `Flowtally Test Burger · Base` → Harbour Burger, and theoretical usage of Chicken Breast 0.18 kg, Bread Buns 0.25 pack, and Lettuce 0.12 head. Actual usage and variance are blank because no completed stock count exists for the selected window. The corresponding Inventory History row shows the real persisted Square order reference above and the -0.2 kg Chicken Breast movement. This is suitable as a traceability illustration, but the Square connection/order detail is not currently available for a fully live end-to-end claim.

The seeded public-demo IDs such as `demo-order-1` remain synthetic and must not be used as production evidence.

## Stock counts, close, and dashboard state

Stock Counts is empty: 0 sessions, 0 active, 0 history. Daily Close is not started, Square is not connected for the location, and there is no close history. Keep both out of the main live route.

Dashboard currently shows $430.30 month-to-date spend across 9 invoices, inventory value $1,179.56 across 23 items, 15 items needing reorder, 2 invoices to review, 18 count checks due, 8 price changes this week, and 16 attention actions. The strongest owner signal is the Reorder Plan plus the Chicken Breast price comparison. Recent price-change examples include Milk 2L +7.5%, Tapioca Pearls 0.25kg +9.1%, and Tea Base 2kg +3.4%.
