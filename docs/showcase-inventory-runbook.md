# Harbour Kitchen Showcase Inventory Preparation

`showcase-replenish` is a production-only, increase-only preparation utility for the explicitly configured `Flowtally Showcase` organization and `Harbour Kitchen` location. It validates every item name, stock unit, minimum and PAR value before returning a plan. It creates only ordinary auditable inventory movements; it never creates supplier invoices or changes costs or prices.

The target profile keeps 16 of 23 items healthy, four moderately low, two at reorder-now levels, and one deliberately out of stock. The low and exception states keep the Reorder Plan and dashboard useful for the alpha recording. Existing Chicken Breast, Bread Buns and Lettuce targets remain 10 kg, 20 packs and 8 heads.

| Item | Unit | Minimum | PAR | Target | Intended state |
| --- | --- | ---: | ---: | ---: | --- |
| Chicken Breast | kg | 4 | 8 | 10 | healthy |
| Rice | kg | 8 | 20 | 22 | healthy |
| Noodles | kg | 4 | 10 | 9 | low |
| Pasta | kg | 2 | 6 | 5.5 | low |
| Tomato Sauce | L | 2 | 5 | 1 | reorder |
| Cream | L | 3 | 9 | 9 | healthy |
| Eggs | dozen | 1 | 3 | 0 | out_of_stock |
| Bread Buns | pack | 6 | 14 | 20 | healthy |
| Lettuce | head | 1 | 4 | 8 | healthy |
| Sugar | kg | 5 | 12 | 12 | healthy |
| Vegetable Oil | L | 4 | 10 | 12 | healthy |
| Tea Base | kg | 10 | 18 | 20 | healthy |
| Milk | L | 6 | 12 | 12 | healthy |
| Tapioca Pearls | kg | 2 | 6 | 0.5 | reorder |
| Cups | each | 12 | 24 | 80 | healthy |
| Lids | each | 8 | 20 | 72 | healthy |
| Straws | each | 10 | 30 | 160 | healthy |
| Napkins | each | 20 | 40 | 220 | healthy |
| Potato | kg | 2 | 8 | 8 | healthy |
| Coffee Beans | kg | 2 | 8 | 7 | low |
| Tomatoes | kg | 2 | 8 | 9 | healthy |
| Onions | kg | 2 | 8 | 6.5 | low |
| Butter | kg | 2 | 8 | 8.5 | healthy |

Run a read-only plan first:

```powershell
flask --app backend.wsgi showcase-replenish `
  --organization-id 1 `
  --location-id 1 `
  --owner-id 1 `
  --dry-run
```

The output includes current quantity, target, adjustment, unit, minimum, PAR, intended status and whether a movement would be written. If current stock is already above a target, the utility leaves it unchanged and reports `already_above_target`. A second run at target creates no movement; later legitimate consumption can be replenished again.

Only after reviewing the dry-run and confirming the production identity should an operator explicitly run the write form with `--confirm-production`.
