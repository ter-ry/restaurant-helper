# First pilot onboarding and support runbook (draft)

Status: **draft for owner review** (#226, #281, preparing for #174). Product capabilities checked against `main` `c6cee28` on 2026-11-05; commercial policy from the #174 owner decision of 2026-11-10.

This runbook covers only what the current code supports. Anything marked **OWNER TO CONFIRM** is a commercial, legal or support decision under #174. It must not be invented, promised or filled in by an agent. Gaps that were found in the code are linked as issues, not described as working.

## 0. What the first pilot gets

| Area | Pilot status | Notes |
|---|---|---|
| Google sign-in, owner and manager roles | Supported | Customers use Google sign-in. The email/password form appears only when seed login is turned on, and is not for customers. |
| Organization, locations, timezone | Supported | The customer creates the organization. Flowtally staff add locations in the setup console. |
| Supplier, item, supplier-item mapping and opening-inventory import (CSV/XLSX) | Supported, with a limit | Opening quantities can be corrected by re-import only until the item has stock history; after that, quantity changes are rejected and rollback is blocked ([#227](https://github.com/ter-ry/restaurant-helper/issues/227)). Import scope verification: #224. |
| Purchases: draft, OCR draft, review, receive | Supported | OCR needs a provider configured in that environment. Every OCR line is reviewed by a person before receiving. |
| Stock counts | Supported | |
| Menu costing (recipes, menu items) | Supported | Recipes are entered by hand. There is no recipe import. |
| Square connection, mapping, sales sync | Supported when `SQUARE_ENABLED=true` with production credentials in that environment | Owner or setup staff only. |
| Daily Close | Supported | Uses Square sales when connected. A finalized close is read-only. |
| Reorder plan | Advisory only | Flowtally does not send orders to suppliers. |
| **Clover** | **Not offered to pilots** | Disabled by default. Inventory writes stay off (`CLOVER_ORDER_INVENTORY_ENABLED`). Blocked on #166/#167. **OWNER TO CONFIRM** any Clover pilot. |
| QuickBooks/accounting export, payroll | Not offered | See `docs/alpha-limitations.md`. |
| In-app support access to customer data | **Not available** | Turned off in code (`SUPPORT_ACCESS_ENABLED = False` in `backend/access.py`). |
| Billing/payment collection | **Not in the product** | Setup fee and subscription states are set by hand by setup staff. Nothing is charged. |

## 0.1 Provisional first-pilot commercial policy (internal only)

Source: [#174 owner decision, 2026-11-10](https://github.com/ter-ry/restaurant-helper/issues/174#issuecomment-6772652786). It builds on the 2026-11-07 provisional price note, which stays as history. **This is an internal provisional offer. It is not signed terms, not a public price and not a contract.** Do not publish it, quote it as final, take payment on it, or change the product, website or checkout because of it. The owner approves the customer-facing terms separately.

| Item | Provisional policy | Still not decided (**OWNER TO CONFIRM**) |
|---|---|---|
| Subscription | CAD $129 per month **per restaurant location**, plus applicable sales taxes | Billing interval beyond monthly; how a multi-location customer is invoiced |
| First pilot | 30 days free, then the normal monthly subscription **only if the customer chooses to continue** under clearly disclosed billing terms. No automatic paid enrollment without the customer's consent | How and when the customer opts in; what happens to their data if they do not continue |
| Setup fee | CAD $299 is **waived for the first pilot customer only**. Whether it applies to later customers is still provisional | Standard setup fee for later customers |
| Commitment | Month-to-month, no long-term minimum | Effective date of cancellation, notice period, refund and proration. None of these may be invented |
| Support | Email is the default channel. Reply **as soon as practicable**. This is not a 24/7 service and not a fixed response-time guarantee. For the first customer only, WhatsApp is also allowed | The support email address, hours, who owns an incident. Never put a private phone number in the repository |
| Taxes | Quote as "$129 + applicable taxes" | Tax registration and treatment, checked by the owner or accountant before any invoice |

What this means in practice:
- Say "provisional" and "plus applicable taxes" whenever you mention the price to anyone.
- Flowtally does not collect payment. The trial start, the subscription and the fee status are set by hand in the setup console (see section 4). Do not tell a customer that billing is automatic.
- Do not promise response times, uptime, 24/7 coverage, refunds, proration, notice periods or data-deletion timelines. None of these are decided.
- Product limits in section 0 still apply. Clover is not offered, and there is no accounting export, payroll or in-app support access.

## 1. Before the customer is invited (Flowtally staff)

1. Confirm that the target environment (production `app.flowtally.ca` / `api.flowtally.ca`) has been deployed and checked. Use `docs/production-deployment.md` and `docs/external-launch-checklist.md`. Record its deployed SHA and Alembic head (#165). Never onboard a pilot onto staging or the showcase/demo tenant.
2. Make sure a staff member has the `setup_admin` platform role. That staff member signs in with Google once, then an operator with database access runs `flask --app backend.wsgi:app platform-role set --email <staff email> --role setup_admin`. This is an owner action and must not be run by an agent.
3. Ask the customer for:
   - business name, each location's name, city and timezone (for example `America/Toronto`)
   - the Google account email of the owner and of each manager
   - supplier list, inventory items with units, PAR/min levels and latest prices, and the opening on-hand quantities as of an agreed opening date
   - recipes and menu selling prices
   - the first invoices to receive
   - Square: whether they use it, and who can authorize the connection
4. **OWNER TO CONFIRM:** the signed pilot terms (based on section 0.1), privacy notice and data-handling wording, billing opt-in wording, tax treatment, and the pilot cancellation and data-export/deletion terms. Do not start step 2 until they are agreed.

## 2. Access setup and organization creation

1. The customer owner signs in with Google at `/app/login`. A first sign-in with no organization goes to onboarding. There the owner enters the organization, the first location (name, city, IANA timezone) and a setup template. They then press **request setup**. This makes them `owner`, sets the organization to `READY_FOR_REVIEW` and sets the setup fee to `pending`.
2. Staff open `/platform/setup`, find the organization and:
   - check the name and add any other locations
   - enable the agreed modules, for example `PURCHASES`, `INVENTORY`, `STOCK_COUNTS`, `MENU_COSTING`, `DAILY_CLOSE`, `REPORTING`, `REORDER_PLANS`, plus `SQUARE_INTEGRATION` if used
   - record any launch blockers
3. The owner invites managers at `/owner/team`. Only the `manager` role can be invited. Invitations expire after 7 days and can be used once. **No email is sent.** The owner must send the generated `/invite/<token>` link to the manager directly. The manager accepts it while signed in with the invited Google email.
4. Organization/location selection: a user with more than one organization or location switches with the organization/location selector in the workspace header, which is backed by `/api/organizations/select` and `/api/locations/select`. Data is isolated per organization and per location (PostgreSQL RLS). Before handoff, confirm that each location shows only its own data.

Role reminder (`backend/policy.py`): owners and managers can run daily operations. Only the owner can manage the organization, team, audit log, imports and Square.

## 3. Supplier, item and opening-inventory import

Done at `/imports` by the owner or setup staff, in this order: **suppliers → inventory items → supplier-item mappings → opening inventory**.

1. Upload a CSV/XLSX file, map the columns, preview it and fix the reported issues. Then **approve** and **execute** it. Imports are not complete until they are approved or executed, and activation stays blocked until then.
2. Check the counts and a sample of rows in Inventory.
3. To undo an import, use **rollback** on the job. Rollback is refused for a supplier that already has linked items or mappings.
4. **Guard ([#227](https://github.com/ter-ry/restaurant-helper/issues/227)):** once an item has a receipt, count, POS sale, adjustment or waste record, an import row that changes its quantity is rejected and rolling back that import is blocked. Correct quantities with a stock count or adjustment. Other fields (par, minimum, supplier) can still be re-imported.

## 4. Approval and activation

1. Staff press **Request review** in `/platform/setup` and walk the customer owner through the setup. Once the owner agrees, staff press **Approve review**. That button needs `setup_admin`. Write down when and how the owner agreed.
2. **OWNER TO CONFIRM:** that the pilot terms were agreed under section 0.1. For the first customer the setup fee is waived and the first 30 days are free, so nothing is paid at this step. Staff then set `setupFeeStatus=confirmed` and the subscription to `ACTIVE` in the setup console, and write down that the fee was waived under the 2026-11-10 decision. These are manual status fields; Flowtally does not take payment. Moving to paid monthly billing after day 30 needs the customer's recorded consent and a separate owner action; it does not happen by default.
3. Press **Activate**. Activation is refused until all of these are true: there is an owner and at least one location, the fee is confirmed, setup is complete, the subscription is active, the customer has approved, every import is approved or finished, there are no blockers, all required modules are enabled, and (if Square is enabled) Square is connected with at least one mapped location. Operational pages stay closed until activation.

## 5. Square connection (only if the customer uses Square)

Done at `/app/square` by the owner.

1. **Connect Square.** This starts Square OAuth for the production Flowtally application.
2. Sync locations and map each Square location to its Flowtally location.
3. Sync the catalog. Map menu items to recipes, or use **menu import** to create menu items from Square.
4. Sync orders. Only completed orders count. Mapped sales consume recipe ingredients once (replays do not double-count). Unmapped items show a warning and do not deduct stock.
5. Check Square usage at `/app/square-usage`. Fix any unmapped items before the first Daily Close.

Square must not be connected to the wrong merchant. If it is, disconnect it and escalate (section 9). Sandbox/staging credentials are never used in production.

## 6. First receipt

At `/app/purchases`:

1. Create a draft invoice by hand, or upload a photo/PDF for an OCR draft.
2. Review every line: supplier, matched item, quantity, unit and price. OCR results are a draft and can be wrong.
3. **Receive.** This posts receipt movements and updates the weighted-average cost. Receiving the same invoice twice is blocked.
4. If a received invoice is wrong, use **Correct**. You must enter a reason. Correct posts reversing movements and marks the invoice `Corrected`. Then enter a new, correct invoice. A wider void/correction policy is still an owner decision (#168).

## 7. Opening stock count

At `/app/stock-counts`: start a count for the location, enter every line and finalize. If stock moved during the count (for example a receipt or a sale), finalize shows the conflict and asks for confirmation. A finalized count is final. Fix later mistakes with a new count or an inventory adjustment. Adjustment reversal is an open owner decision (#196).

## 8. First Daily Close

At `/app/daily-close`, for the location's business date:

1. Open the day's close.
2. If Square is connected, **sync sales**. This needs Square locations to be mapped.
3. Enter counted cash and any manual reconciliation figures. Review the exceptions and variance. Variance needs valid stock-count boundaries.
4. **Finalize.** A finalized close cannot be edited, and there is no reopen. Do not finalize until the owner agrees the figures. Until then, leave the close open as a draft.

## 9. Handoff check, rollback and escalation

Before handoff, confirm each of these and record the result:
- sign-in and sign-out for the owner and one manager
- a purchase read and receive
- an inventory read
- a Square mapping read
- a stock-count read
- a Daily Close read
- location isolation

Never share staging or demo credentials with the restaurant.

Safe rollback:

| Situation | Action |
|---|---|
| Bad import before any receipt, count or sale | Roll back the import job, then re-import. |
| Bad received invoice | **Correct** with a reason, then re-enter it. |
| Wrong count or quantity | New stock count or inventory adjustment. Never edit the database. |
| Wrong Square merchant/location | Owner disconnects Square and staff fix the location mapping. Escalate before syncing more orders. |
| Customer must be paused | Staff set the lifecycle to `SUSPENDED` in the setup console. **OWNER TO CONFIRM:** wording and process for suspension and cancellation. |
| Suspected data, security or cross-tenant problem | Stop the onboarding, do not change data, and escalate straight to the owner. |

Escalation:
- Support is by email, answered as soon as practicable (no fixed response time). WhatsApp is allowed for the first customer only. **OWNER TO CONFIRM:** the exact support email address, hours, WhatsApp number (share it outside the repository), and who owns a pilot incident.
- Staff cannot see customer data through in-app support access, because support access is off. Diagnosis goes through the customer's screen share, the audit log (`/owner/audit`) and the setup console.
- Production data fixes, deploys and console changes (Render, Aiven, Square, Google) need owner approval. Agents never touch live data.

## 10. Evidence to keep for each pilot

- organization ID, location IDs, environment, deployed SHA and Alembic head at go-live
- the activation checklist, with its time and the staff member who ran it
- import job IDs and their final status
- the first invoice ID received, the first count ID finalized, and the first Daily Close date finalized
- the Square merchant and location mapping (no tokens)
- the handoff check results

Keep this in the pilot record. **OWNER TO CONFIRM:** where the pilot record lives and how long it is kept. Never record credentials, tokens or customer financial exports in the repository.

## 11. Onboarding checklist (staff)

- [ ] Section 0.1 reviewed. The owner has approved the customer-facing terms for this customer.
- [ ] Production environment checked and its deployed SHA and Alembic head recorded (#165).
- [ ] Staff member has `setup_admin`.
- [ ] Customer details collected (section 1, step 3).
- [ ] Owner signed in and requested setup; locations and modules set; managers invited (section 2).
- [ ] Imports approved or finished and spot-checked (section 3).
- [ ] Review approved and the customer's agreement written down (section 4).
- [ ] Fee status set (waived for the first customer) and subscription set to `ACTIVE` by hand, with the trial start date recorded.
- [ ] Activated. Square connected and mapped, if used (section 5).
- [ ] First receipt, opening count and first Daily Close walked through (sections 6 to 8).
- [ ] Handoff check done and recorded (section 9).
- [ ] Pilot record started (section 10).

## 12. First-pilot consent and hand-off checklist

Complete this with the customer owner, and record the date and how they agreed. Do not start the 30-day trial clock until all of it is done.

- [ ] The customer has been shown the final owner-approved terms, not this internal draft.
- [ ] They understand the price: CAD $129 per month per location, plus applicable taxes, with the setup fee waived.
- [ ] They understand the first 30 days are free, and that a paid subscription starts after that only if they choose to continue. Their choice is recorded.
- [ ] They understand it is month-to-month with no long-term minimum, and have been given the cancellation wording the owner approved.
- [ ] They have the privacy and data-handling wording the owner approved.
- [ ] They know support is by email, answered as soon as practicable, and have the exact support address. If WhatsApp is offered, they know it is for this pilot only and is not a guaranteed channel.
- [ ] They know what Flowtally does not do yet: no Clover, no accounting export or payroll, no supplier ordering, no payment collection in the product (section 0).
- [ ] They know that a finalized Daily Close and a finalized stock count cannot be edited (sections 7 and 8).
- [ ] Owner and manager Google accounts confirmed. Invite links were sent to managers directly.
- [ ] No credentials, tokens or customer financial exports were put in the repository.

## OWNER TO CONFIRM (tracked under #174)

Decided as provisional on 2026-11-10 (section 0.1): $129 per location per month plus taxes, a 30-day free first pilot, the first customer's setup fee waived, month-to-month, email-first support with WhatsApp for the first customer. Still open:

1. Pilot terms in writing, including cancellation effective date, notice period, refund and proration, and data export and deletion when the pilot ends.
2. How the customer opts in to paid billing after the free 30 days, and what happens to their data if they do not.
3. Privacy notice and legal wording shown to the customer.
4. Exact support email address, hours, WhatsApp handling for the first customer, and who owns a pilot incident.
5. Tax registration and treatment, confirmed by the owner or accountant before any invoice.
6. Standard setup fee and billing rules for customers after the first, and whether and how multi-location customers are billed.
7. Whether a Clover customer can be piloted, and when (needs #166/#167 evidence first).
8. Where pilot evidence is stored and for how long.

## Related runbooks

- `docs/production-deployment.md`, `docs/external-launch-checklist.md`: environment setup
- `docs/commercial-product-staging-readiness.md`: how `setup_admin` is set up, and checks for sharing one environment between tenants
- `docs/pilot-end-to-end-readiness.md`: workflow evidence and remaining checks
- `docs/alpha-limitations.md`, `docs/public-claims-audit.md`: what not to promise
- `docs/square-showcase-sales-runbook.md`, `docs/showcase-runbook.md`: demo only; never use them for a customer tenant
