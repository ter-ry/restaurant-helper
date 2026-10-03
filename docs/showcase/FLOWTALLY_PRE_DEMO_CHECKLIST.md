# Flowtally Pre-Demo Checklist

## 24 hours before

- Confirm `/api/health` completes and the production login page can reach the OAuth start endpoint.
- Confirm the showcase account can sign in and opens Harbour Kitchen.
- Confirm Square connection status and at least one mapped variation; do not reconnect or change credentials during rehearsal.
- Confirm the chosen completed purchase and inventory anchors exist.
- Confirm whether OCR is genuinely available in the production path; otherwise prepare a screenshot or field-by-field walkthrough.
- Confirm any Daily Close data is meaningful; otherwise remove it from the route.
- Prepare the one-pager, runbook, talk track, and fallbacks.

## 30 minutes before

- Use a clean browser profile and close unrelated tabs.
- Open Dashboard, Purchases, Inventory, Square, Menu Costing, Reorder Plan, and the runbook.
- Verify the tenant and location labels.
- Verify the current screen values; update the chosen invoice and stock anchors if data changed.
- Check that no tokens, personal email, OAuth URLs, or internal admin screens are visible.
- Keep a prepared invoice image/fields and screenshots available offline.
- Do not upload, create, receive, sync, reseed, or reset production data.

## Immediate two-minute check

1. Load `/api/health` and wait for a real response, not a Render loading interstitial.
2. Sign in and confirm Harbour Kitchen.
3. Open the first three pages in the runbook.
4. Confirm Square status/mapping is readable.
5. Confirm the selected purchase exists.
6. Decide whether Daily Close is in or out.
7. If any check fails, switch to the five-minute fallback path and say what is being demonstrated.
