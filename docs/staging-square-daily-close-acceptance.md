# Staging Square + Daily Close Acceptance Checklist

Use this checklist for the Flowtally alpha staging flow once the repository build is deployed to staging.

## Preconditions

- Frontend: `https://staging.flowtally.ca`
- Backend/API: `https://api-staging.flowtally.ca`
- Square mode: Sandbox
- Required modules: `PURCHASES`, `INVENTORY`, `STOCK_COUNTS`, `REORDER_PLANS`, `MENU_COSTING`, `SQUARE_INTEGRATION`, `DAILY_CLOSE`
- A test restaurant/org with one active location
- A mapped Square location and at least one mapped Square variation -> Flowtally menu item
- At least one recipe using that menu item

## A. Square OAuth

1. Open `/app/square`.
2. Disconnect if already connected.
3. Click Connect Square.
4. Complete Square Sandbox OAuth.
5. Confirm the browser returns to `/app/square`.
6. Confirm the connected state shows:
   - merchant details
   - location mapping section
   - catalog/menu mapping section
   - sync actions

## B. Mapping

1. Map one Square location to the active Flowtally restaurant location.
2. Map one Square item variation to the correct Flowtally menu item.
3. Confirm the mapping stays visible after refresh.

## C. Sandbox Order

1. Create and complete a Sandbox Square order that uses the mapped item.
2. Use the same business date you plan to review in Daily Close.
3. Confirm the order appears after sync.

## D. Sync

1. Open `/app/square`.
2. Click the primary `Sync now` action.
3. Confirm success state: `Sync now completed.`
4. Confirm location sync, catalog sync, and order sync all complete.

## E. Usage & Variance

1. Open `Usage & Variance`.
2. Confirm theoretical usage is visible.
3. Confirm coverage and unmapped warnings are visible if applicable.
4. Confirm no physical inventory is decremented by Square sales alone.

## F. Daily Close

1. Open `/app/daily-close`.
2. Select an explicit business date.
3. Start or open a draft close.
4. Click `Sync sales`.
5. Confirm sales summary updates.
6. Confirm theoretical usage is visible.
7. Confirm actual usage or an explicit incomplete-stock-count warning is visible.
8. Confirm variance / exception information is visible.
9. Enter a Daily Close note.
10. Finalize the close.

## G. Completed History

1. Open the completed close from History.
2. Confirm the record is read-only.
3. Confirm the stored snapshot remains visible.
4. Confirm sync, edit, and finalize controls are unavailable for the completed record.

## H. Failure Evidence to Capture

- Exact browser error text
- Render or backend traceback
- Request path and HTTP status
- Square API error body or event ID, if available
- Whether the failure happened before or after OAuth callback completion
