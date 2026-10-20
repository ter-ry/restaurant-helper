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

The intended staging configuration is:

- Site URL: `https://api-staging.flowtally.ca/`
- `CLOVER_ENVIRONMENT=sandbox`
- `CLOVER_REGION=north_america`
- `CLOVER_REDIRECT_URI=https://api-staging.flowtally.ca/api/integrations/clover/callback`
- Clover high-trust OAuth authorization-code flow

The Clover App Market launch flow is not implemented and must not be treated as supported.

Register the exact callback URL in the Clover developer dashboard and enable the high-trust OAuth flow for the sandbox application. The connection page starts OAuth, verifies the returned merchant identity with Clover, and stores only encrypted tokens. Disconnect clears local credentials; Clover does not document a remote token-revocation endpoint for this flow.

The frontend displays connection status, merchant identity, expiry/re-authorization state, and safe errors. No live Clover merchant is used by tests or local development.
