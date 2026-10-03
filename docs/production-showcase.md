# Production showcase tenant

Flowtally's public Harbour Kitchen demo remains a separate isolated,
read-only deployment. The private sales showcase is a normal organization in
the existing production database and uses the same production application,
authentication, RLS, modules, and workflows as a customer.

## Provisioning

1. Create the owner account through the normal production login/onboarding flow.
2. Create the prospect organization with the name `Flowtally Showcase` and a
   location named `Harbour Kitchen`.
3. Use the setup console to complete configuration, enable the required
   modules, and activate the organization.
4. Set `FLOWTALLY_SHOWCASE_ORGANIZATION_ID` in the production operator
   environment to the immutable organization ID. This is the target marker;
   the seed command also checks the exact organization and location names,
   ownership, lifecycle, and production database identity.

The production-only command requires an explicit owner and location and never
performs a global reset:

```text
flask --app backend.wsgi:app showcase-seed \
  --organization-id <showcase-organization-id> \
  --location-id <harbour-kitchen-location-id> \
  --owner-id <showcase-owner-id> \
  --confirm-production
```

The command refuses non-production environments, `defaultdb`, mismatched
database names, any organization other than the configured ID, locations from
another organization, non-owner actors, and organizations that are not active
and complete. It writes only to the selected tenant, records an audit event,
and is safe to repeat. It does not call the global pilot reset helpers.

The seeded records provide supplier and purchase history, inventory balances
and movements, recipes and menu costing, reorder signals, stock-count context,
daily-close context, and synthetic Square history as a starting point for live
workflow demonstrations. Reporting is registered but remains marked
`backendReady: false` until that module is completed.

## Square boundary

Square remains process-wide in the current production service. Production
uses `SQUARE_ENVIRONMENT=production`; staging uses Sandbox. Do not connect a
Sandbox merchant to the production service. Supporting Showcase → Sandbox
and customer → Production in one service requires a future per-connection
environment and credential-routing change.

The public demo's isolated database, read-only guard, synthetic Square data,
and dedicated origins remain unchanged.

## Production OAuth incident record

An earlier Production OAuth attempt failed because the Render deployment held an incorrect or stale SQUARE_APPLICATION_SECRET. The deployment configuration was corrected, and a real seller OAuth/token, location, catalog, order, and inventory workflow was subsequently validated. This record intentionally contains no secrets, tokens, authorization codes, or merchant identifiers.
