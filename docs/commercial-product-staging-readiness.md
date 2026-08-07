# Flowtally commercial product staging readiness

Date: 2026-08-07
Branch: `codex/complete-commercial-product-foundation`
Current repo head at time of writing: `3a8cabe0b4e1626c2f8f1ae7b5e9937078aef2b3`

This document describes the repository-ready configuration for a staging deployment of the commercial Flowtally app. It does not claim that staging has been deployed or manually validated.

## Recommended staging topology

The repository now supports two safe hosting patterns:

1. Same-origin staging, where the frontend and backend are served from the same origin and `/api` requests remain relative.
2. Split-origin staging, where the frontend is hosted on `https://staging.flowtally.ca` and the backend is hosted on `https://api-staging.flowtally.ca` with the frontend configured through `VITE_FLOWTALLY_API_BASE_URL`.

If the team wants the least moving parts, same-origin is simpler. If the team prefers separate frontend and API services, the shared API base helper in `src/lib/apiBase.ts` supports it.

## Render backend configuration

Use the authenticated backend entrypoint only:

- Start command: `gunicorn backend.wsgi:app --bind 0.0.0.0:$PORT --access-logfile - --error-logfile -`
- Health check: `/api/health`
- Build: `pip install -r backend/requirements.txt`

Do not point staging at the legacy root app.

## Render frontend configuration

If staging is split-origin:

- Serve the Vite production build from `staging.flowtally.ca`
- Set `VITE_FLOWTALLY_API_BASE_URL=https://api-staging.flowtally.ca`

If staging is same-origin:

- Keep `VITE_FLOWTALLY_API_BASE_URL` unset
- Serve frontend and backend behind one origin so relative `/api` requests keep working

The repository already uses lazy-loaded routes and a smaller initial bundle, so no additional rewrite is required for staging.

## PostgreSQL configuration

Use two distinct roles:

- Migration role: can run schema migrations only
- Runtime role: used by the application at runtime and must not have `BYPASSRLS`

Recommended database settings:

- `DATABASE_URL`: runtime connection string
- Migration job or one-off worker: separate elevated connection string
- `FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL=false`

The application already relies on tenant context and PostgreSQL row-level security for customer-owned data. Staging should validate that the runtime role cannot bypass RLS.

## Google OAuth configuration

Required environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Use the backend callback route as the redirect URI:

- `https://api-staging.flowtally.ca/api/auth/google/callback`

The browser-facing completion page remains:

- `https://staging.flowtally.ca/auth/google/complete`

That page is reached after the backend completes the OIDC exchange and redirects back to the frontend.

## Square Sandbox configuration

Required environment variables:

- `SQUARE_APPLICATION_ID`
- `SQUARE_APPLICATION_SECRET`
- `SQUARE_REDIRECT_URI`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `INTEGRATION_ENCRYPTION_KEY`

Use the backend callback and webhook routes:

- OAuth callback: `https://api-staging.flowtally.ca/api/integrations/square/callback`
- Webhook endpoint: `https://api-staging.flowtally.ca/api/integrations/square/webhooks`

Staging must use Square Sandbox credentials only. The repository already rejects production Square credentials when staging mode is enabled.

## CORS and cookies

Set:

- `FLOWTALLY_ALLOWED_ORIGINS=https://staging.flowtally.ca`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_SAMESITE=Lax`
- `SESSION_COOKIE_HTTPONLY=true` is already enforced by the backend defaults

If the frontend and backend are split across origins, the backend origin must be allowed explicitly and the browser must send credentials.

## Other required secrets

Set and protect:

- `SECRET_KEY`
- `DATABASE_URL`
- `FLOWTALLY_RATE_LIMIT_STORAGE_URI`
- `INTEGRATION_ENCRYPTION_KEY`
- Google OAuth secrets
- Square OAuth secrets

Do not reuse production secrets in staging.

## Health checks

Recommended checks:

- `GET /api/health` for the backend
- Frontend root route returns the public site
- Authenticated `GET /api/auth/me` returns a session only after login
- Square and Google callback routes return safe errors when credentials are absent

## Backup and restore

Before first customer onboarding, staging should have:

- Automated database backups enabled in the managed PostgreSQL provider
- A documented restore test
- A documented rollback procedure for the current migration head

Restore test checklist:

1. Restore a recent backup into a separate temporary database.
2. Run the migration head check.
3. Confirm tenant-scoped data is still isolated.
4. Confirm the app can boot against the restored database.

## Platform-admin bootstrap

The internal setup console requires a user with the `setup_admin` platform role.

Bootstrap approach:

1. Create a normal Flowtally user through the Google login flow.
2. Insert or grant the `setup_admin` platform role for that user in the staging database.
3. Verify the user can open `/setup`.
4. Keep the bootstrap path documented and restricted to staff only.

The repository already uses this role in tests and in the setup-console authorization checks.

## Manual external steps still required

The repository now contains the configuration hooks and documentation, but staging still requires:

- A real Google OAuth application and consent screen
- A real Square Sandbox application
- Managed PostgreSQL provisioning
- DNS records for the two staging hostnames, if split-origin hosting is used

Those external steps cannot be completed safely from the repository alone.
