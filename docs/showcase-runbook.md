# Flowtally showcase runbook

## 15–20 minute restaurant-owner story

1. **Dashboard (2 min):** start with the attention queue: what needs money, time, or a decision today.
2. **Purchase (3 min):** upload an invoice, show OCR extraction, correct one field, and receive it into inventory.
3. **Inventory (2 min):** show the supplier price change and the item’s current on-hand value.
4. **Menu Costing (2 min):** open a recipe, show ingredient cost and selling-price context.
5. **Square (2 min):** show the connected catalog and a mapped menu item; explain that sales become theoretical usage.
6. **Waste and count (3 min):** record a waste event, then review a small stock-count variance.
7. **Variance and Daily Close (3 min):** connect expected inventory to the close equation and the remaining follow-up.
8. **Export readiness (1 min):** show the clean purchase, close, and reporting handoff.

Keep the conversation on dollars, time saved, and control. Use the demo story instead of inventing customer data live.

## 45–60 minute product review

- Architecture: separate frontend/backend origins, Flask API, PostgreSQL, tenant context, RLS and FORCE RLS.
- Purchasing: OCR review, supplier and line mapping, receiving, weighted-average cost, and price history.
- Inventory: movements, waste versus adjustments, counts, reorder advisory, and supplier mappings.
- Menu Costing: recipes, ingredient costs, menu-item prices, and Square catalog relationships.
- POS usage: Square mapping and theoretical usage; it does not replace a POS.
- Daily Close: sales, expected inventory, physical count, and unexplained variance.
- Limitations: Square is the first POS; QuickBooks is not integrated; OCR can need review; reorder does not submit supplier orders; setup is assisted; public demo is read-only; reporting/export is alpha scope.
- Review questions: tenant isolation, role separation, migration process, auditability, and what remains deliberately deferred.
