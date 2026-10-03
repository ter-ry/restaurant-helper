# Flowtally Showcase Assets

Capture date: 2026-10-03 (America/New_York)

The production browser session produced clean in-session screenshots of the Dashboard and loaded Usage / Variance state. The current browser bridge did not permit writing screenshot bytes to the isolated worktree or workspace, so no persistent image files are claimed below. The filenames are the intended local names for a manual capture or a future recorder pass.

| Filename | Local path | Page | Demonstrates | Recommended use | Evidence classification |
|---|---|---|---|---|---|
| `01-dashboard.png` | Not persisted; in-session capture only | `/app/dashboard` | 15 reorder items, 2 reviews, 8 price changes, 16 attention actions | Opening and closing frame | live production showcase state |
| `02-purchases.png` | Not persisted; capture after data loads | `/app/purchases` | Completed history plus two drafts needing review | Purchase-control context | live production showcase state |
| `03-purchase-ov1041.png` | Not persisted; capture after opening record | `OV-1041` detail | Oak Valley, $7.80/kg, completed/read-only record, source PDF, 92% confidence | Purchase review proof | seeded production showcase data |
| `04-purchase-ov1038.png` | Not persisted; capture if comparison is useful | `OV-1038` detail/list | Prior Chicken Breast price at $7.20/kg | Price-change comparison | seeded production showcase data |
| `05-chicken-breast.png` | Not persisted; in-session capture possible | Inventory item dialog | 3.1kg on hand, minimum 4kg, PAR 8kg, latest $7.80 | Inventory control | live production showcase state |
| `06-inventory-movements.png` | Not persisted; capture after opening History | Chicken Breast movements | Invoice receipts and -0.2kg persisted Square-order consumption | Traceability proof | persisted historical integration evidence |
| `07-harbour-burger-costing.png` | Not persisted; capture after data loads | Menu Costing | $18 price, $2.21 cost, 12.3% food cost | Costing proof | live production showcase state |
| `08-harbour-burger-recipe.png` | Not persisted; capture after opening recipe | Harbour Burger recipe | 0.2kg Chicken Breast, 0.3 pack Bread Buns, 0.1 head Lettuce | Recipe proof | live production showcase state |
| `09-square-usage.png` | Not persisted; loaded in-session capture possible | Usage / Variance | `Flowtally Test Burger · Base` → Harbour Burger, 1 sold, theoretical usage | Historical usage trace | persisted historical integration evidence |
| `10-reorder-plan.png` | Not persisted; capture after data loads | Reorder Plan | Chicken Breast 4.9kg/$36.66 and Eggs 3 dozen/$17.70 | Owner action proof | live production showcase state |

## State boundaries

- Square Setup & Sync currently reports disconnected, no mapped locations, no mapped menu items, and no imported sales summaries.
- Usage / Variance and Inventory History retain persisted historical evidence, but it must not be described as a currently connected Square transaction.
- `OV-1041` extraction status is manual and its raw OCR text is seeded pilot invoice; it is not a live OCR-capture asset.
- Daily Close and Stock Counts are intentionally omitted because they are empty/incomplete.

## Video assets

None created. See [FLOWTALLY_SHOWCASE_RECORDING_PLAN.md](FLOWTALLY_SHOWCASE_RECORDING_PLAN.md) for the silent walkthrough shot list and recording requirements.
