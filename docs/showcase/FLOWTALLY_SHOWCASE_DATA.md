# Flowtally Showcase Data Map

This is a rehearsal map derived from repository seed definitions. It is not proof that the current production tenant contains every record. Read the live screen before making a claim.

## Tenant and location

- Tenant: Harbour Kitchen / Flowtally Showcase
- Location: Harbour Kitchen
- Private pilot routes: `/app/dashboard`, `/app/purchases`, `/app/inventory`, `/app/stock-counts`, `/app/reorder-plan`, `/app/menu-costing`, `/app/square`, `/app/square-usage`, `/app/daily-close`

## Best purchase story

| Invoice | Supplier | Status | Item | Quantity | Unit price |
|---|---|---|---|---:|---:|
| OV-1041 | Oak Valley Meat Co | Completed | Chicken Breast 1kg | 1 | $7.80 |
| OV-1038 | Oak Valley Meat Co | Completed | Chicken Breast 1kg | 1 | $7.20 |

Other seeded suppliers include Metro Packaging, GTA Beverage Supply, Fresh Dairy Toronto, Northern Produce Market, and Harbour Dry Goods. Draft invoices exist; do not use them as completed evidence.

## Inventory anchors

Chicken Breast: latest $7.80, minimum 4kg, par 8kg. Rice: 9kg, minimum 8kg, par 20kg. Bread Buns: 4 packs, minimum 6, par 14. Lettuce: 0.5 head, minimum 1, par 4. Eggs: 0 dozen, minimum 1, par 3. Cups: 24, minimum 12, par 24. These are rehearsal anchors only; confirm current values on screen.

## Recipe and menu anchors

- Harbour Burger — $18.00; Chicken Breast 0.18kg, Bread Buns 0.25 pack, Lettuce 0.12 head.
- Chicken Rice Bowl — $17.50; Chicken Breast 0.20kg, Rice 0.16kg, Onions 0.03kg.
- Toronto Breakfast — $15.00; Eggs, Potato, Butter.
- House Salad — $12.00; Lettuce, Tomatoes, Onions.
- Iced Latte — $5.50; Coffee Beans, Milk, Cups.

Seasonal Soup is intentionally a no-recipe example; do not use it to demonstrate automated consumption.

## Square caution

The seeded official demo uses synthetic IDs such as `demo-order-1` and a demo-only connection. These are not real production transactions. A real production claim requires a visibly connected production Square account, a mapped variation, and an existing completed order whose status can be read in the UI.

## Reorder and count anchors

Seeded reorder intents include Chicken Breast, Tomato Sauce, Lettuce, Tapioca Pearls, and Eggs. Seeded stock-count examples include Chicken Breast, Rice, Cups, Tapioca Pearls, and Eggs. Use the screen’s current status and never present seeded values as a live count without verification.
