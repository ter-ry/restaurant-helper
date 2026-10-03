# Flowtally Showcase QA

## Questions an owner may ask

- Does this replace Square? No; it sits around the POS.
- Does it replace accounting? No; accounting/export remains a boundary.
- What happens to an invoice? It becomes reviewable purchasing evidence and, once approved, an inventory movement.
- What does a stock count do? It records an observed quantity and creates a variance/action context.
- Can recipes explain usage? Yes, when the menu variation is mapped to a recipe and the sale is available.
- What is automated versus manual? Integration and mapping can automate inputs; review, approval, counts, and owner decisions remain controlled actions.
- What happens when data does not match? The exception should be reviewed rather than silently treated as truth.

## Product and business questions

- Which three workflows are in scope for the pilot?
- What would the owner check every morning?
- What currently lives in spreadsheets or text messages?
- What is the cost of a missed invoice, stockout, or recipe mismatch?
- Which integration is required first: Square, supplier invoices, or accounting export?
- What onboarding data is needed: locations, items, suppliers, recipes, and reorder levels?

## Technical diligence questions

- Which Square environment and merchant are connected, and how are variations mapped?
- Is the shown order real production data or synthetic demo data?
- Where does OCR stop and human review begin?
- How are tenant and location boundaries enforced?
- Is there an audit trail for invoice approval, stock counts, and inventory adjustments?
- Is consumption deterministic and idempotent if a webhook or sync repeats?
- What happens when a recipe or mapping is missing?
- Which data is authoritative for quantity, unit, price, and sale status?
- What is the deployment/health check and how is a cold start detected?
- Which areas remain unfinished, especially Reporting?

## QA sign-off gates

- Production health returns a real response.
- Showcase account and location are verified.
- Square status/mapping is readable, or the fallback is selected.
- Invoice and inventory values are read from the current screen.
- No mutation is required to tell the story.
- Every live claim has visible evidence or is explicitly labelled as a prepared illustration.
