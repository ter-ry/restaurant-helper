# Clover sandbox connection setup

This milestone supports a connection-only Clover sandbox OAuth flow. It does not import Clover catalog, orders, webhooks, inventory, or daily-close data.

Configure these values in the backend environment (never commit them):

- `CLOVER_ENABLED=true`
- `CLOVER_ENVIRONMENT=sandbox`
- `CLOVER_REGION=north_america`
- `CLOVER_CLIENT_ID`
- `CLOVER_CLIENT_SECRET`
- `CLOVER_REDIRECT_URI` (for example `https://api.example.test/api/integrations/clover/callback`)
- existing `INTEGRATION_ENCRYPTION_KEY`
- `FLOWTALLY_FRONTEND_ORIGIN` (the HTTPS staging frontend origin)
- `FLOWTALLY_ALLOWED_ORIGINS` (including that exact frontend origin)
- `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=Lax`

The intended staging configuration is:

- Site URL: `https://flowtally-api-staging.onrender.com/`
- Alternate Launch Path: `/api/integrations/clover/launch`
- `CLOVER_ENVIRONMENT=sandbox`
- `CLOVER_REGION=north_america`
- `CLOVER_REDIRECT_URI=https://flowtally-api-staging.onrender.com/api/integrations/clover/callback`
- Default OAuth response: Code
- Clover server-side/high-trust OAuth v2 authorization-code flow

The merchant-dashboard launch path stores the Clover merchant context, then asks
the signed-in Flowtally user to confirm the selected organization before OAuth
starts. The merchant identifier is never used to select an organization.
The Alternate Launch Path is the implemented merchant-dashboard entry point; no Clover App Market listing or launch claims are made by this milestone.

Register the exact callback URL in the Clover developer dashboard and enable the high-trust OAuth flow for the sandbox application. The connection page starts OAuth, verifies the returned merchant identity with Clover, and stores only encrypted tokens. Disconnect clears local credentials; Clover does not document a remote token-revocation endpoint for this flow.

The callback returns to the configured frontend origin and relies on the
backend session cookie being retained across the frontend/backend origins.
Use the exact HTTPS origins above; do not add a Render hostname redirect or
relax the secure/SameSite cookie settings.

The frontend displays connection status, merchant identity, expiry/re-authorization state, and safe errors. No live Clover merchant is used by tests or local development.


## Production-isolated sandbox rollout

Production remains sandbox-only and connection-only. Enable Clover for only an explicitly approved existing organization by setting:

- `CLOVER_ENABLED=true`
- `CLOVER_ENVIRONMENT=sandbox`
- `CLOVER_REGION=north_america`
- `CLOVER_CLIENT_ID` and `CLOVER_CLIENT_SECRET` from the Clover sandbox application
- `CLOVER_REDIRECT_URI=https://api.flowtally.ca/api/integrations/clover/callback`
- `CLOVER_ALLOWED_ORGANIZATION_IDS=<approved existing organization id>`

The allowlist is mandatory in production. Setup-admin access does not bypass it, and organizations outside it receive no usable Clover connection controls or connection-detail disclosure. The merchant-dashboard Alternate Launch Path remains `/api/integrations/clover/launch`; Flowtally requires an authenticated user to select and authorize the organization before OAuth state is created.

Preserve the existing `FLOWTALLY_FRONTEND_ORIGIN`, `FLOWTALLY_ALLOWED_ORIGINS`, `INTEGRATION_ENCRYPTION_KEY`, `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAMESITE=Lax`, and Square settings. Do not add a new database, service, catalog sync, order sync, webhook, inventory, or daily-close integration.

Rollback is configuration-only: set `CLOVER_ENABLED=false` (or remove the Clover variables) and redeploy. Do not change the allowlist to include customer organizations as a workaround. Validate the exact HTTPS callback and Alternate Launch Path in the Clover sandbox dashboard before enabling the flag.
