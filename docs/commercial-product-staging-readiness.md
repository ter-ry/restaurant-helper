# Flowtally commercial product staging readiness

Date: 2026-08-07
Branch: `codex/complete-commercial-product-foundation`
Current repo head at time of writing: `118394f1daf61aeea7e8abfe1ac182cf0f0657f6`

This document is the repository-side staging runbook for the commercial Flowtally app. It is intentionally narrow: it describes what the repository can already support, what must be configured externally, and what still needs manual validation before any real staging launch.

It does not claim that staging has been deployed or manually validated.

## Current validation snapshot

These checks were run locally in this workspace:

- `python -m pytest backend/tests -q -rs` → `68 passed, 9 skipped`
- `python -m unittest discover -s tests` → `15 passed`
- `npm test` → `5 passed`
- `npm run typecheck` → passed
- `npm run lint` → passed with warnings only
- `npm run build` → passed
- `npm run e2e` → `8 passed` and exited normally
- `git diff --check` → clean

The nine backend skips are the PostgreSQL-service-gated tests in:

- `backend/tests/test_migrations_postgres.py`
- `backend/tests/test_postgres_rls.py`

They are expected to skip in this local workspace because no temporary PostgreSQL service is available here. The repository and CI configuration now include the service-backed execution path.

## CI assessment

The repository CI workflow in `.github/workflows/ci.yml` is already wired for the commercial foundation:

- Backend job
  - starts `postgres:16` as a service
  - waits on `pg_isready -U flowtally -d flowtally_test`
  - sets `FLOWTALLY_TEST_POSTGRES_URL=postgresql+psycopg2://flowtally:flowtally@localhost:5432/flowtally_test`
  - runs `git diff --check`
  - runs the fresh-database migration test
  - runs `python -m pytest backend/tests`
  - runs `python -m unittest discover -s tests`
- Frontend job
  - runs `npm run lint`
  - runs `npm run typecheck`
  - runs `npm test`
  - installs Playwright Chromium
  - runs `npm run e2e`
  - runs `npm run build`

I have not executed GitHub Actions from this workstation, so CI remains repository-configured but not externally observed from this session.

## Recommended staging topology

The repository supports two safe deployment patterns:

1. Same-origin staging, where the frontend and backend share one origin and `/api` stays relative.
2. Split-origin staging, where the frontend is `https://staging.flowtally.ca` and the backend is `https://api-staging.flowtally.ca`, with the frontend configured through `VITE_FLOWTALLY_API_BASE_URL`.

For the least operational complexity, same-origin is simpler. For a more production-like split, the shared API base helper in `src/lib/apiBase.ts` supports separate frontend and API hosts.

## Exact staging deployment checklist

Before declaring a staging environment ready, verify each item:

- [ ] Create the frontend and backend services in Render or the chosen host.
- [ ] Attach a managed PostgreSQL instance.
- [ ] Configure separate runtime and migration database roles.
- [ ] Set the backend runtime environment variables listed below.
- [ ] Set the frontend API base variable if using split-origin hosting.
- [ ] Add Google OAuth redirect configuration for the backend callback route.
- [ ] Add Square Sandbox OAuth and webhook configuration for the backend callback routes.
- [ ] Configure allowed origins and secure cookies.
- [ ] Configure integration encryption and rate-limit storage.
- [ ] Run the migration deployment procedure below against the staging database.
- [ ] Boot the backend and confirm `/api/health` responds.
- [ ] Confirm the public site loads and the authenticated route stays protected.
- [ ] Perform the manual validation plan below with two isolated tenant fixtures.

## Environment-variable checklist

Group the variables by purpose so staging setup is easier to audit.

### Core backend and runtime

| Variable | Required for staging | Purpose |
| --- | --- | --- |
| `SECRET_KEY` | Yes | Flask session and app signing secret. Must be strong and unique to staging. |
| `DATABASE_URL` | Yes | Runtime database connection string. Use the runtime role here. |
| `FLOWTALLY_ALLOWED_ORIGINS` | Yes | Explicit allowed browser origins, comma-separated. |
| `SESSION_COOKIE_SECURE` | Yes | Must be `true` in staging. |
| `SESSION_COOKIE_SAMESITE` | Recommended | Keep `Lax` unless a later cookie flow requires stricter handling. |
| `FLOWTALLY_RATE_LIMIT_STORAGE_URI` | Yes | Shared rate-limit backend. |
| `FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL` | Yes | Set to `false` in staging. |

### Google OIDC

| Variable | Required for staging | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes if Google login is enabled | Google OAuth client identifier. |
| `GOOGLE_CLIENT_SECRET` | Yes if Google login is enabled | Google OAuth client secret. |
| `GOOGLE_REDIRECT_URI` | Yes if Google login is enabled | Must point to the backend callback route. |

### Square Sandbox

| Variable | Required for staging | Purpose |
| --- | --- | --- |
| `SQUARE_APPLICATION_ID` | Yes if Square is enabled | Square Sandbox client identifier. |
| `SQUARE_APPLICATION_SECRET` | Yes if Square is enabled | Square Sandbox client secret. |
| `SQUARE_REDIRECT_URI` | Yes if Square is enabled | Must point to the backend callback route. |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Yes if Square is enabled | Used to verify webhook signatures. |
| `INTEGRATION_ENCRYPTION_KEY` | Yes if Square is enabled | Fernet key used to encrypt integration tokens. |

### Frontend

| Variable | Required for staging | Purpose |
| --- | --- | --- |
| `VITE_FLOWTALLY_API_BASE_URL` | Only for split-origin staging | Points the browser at `https://api-staging.flowtally.ca`. |

### Practical notes

- The backend config rejects weak or missing secrets in staging and production.
- The backend config rejects SQLite in non-local environments unless the explicit override is set.
- The backend config requires `FLOWTALLY_ALLOWED_ORIGINS` and `SESSION_COOKIE_SECURE=true`.
- The repository tests already cover the configuration guardrails in `backend/tests/test_config.py`.

## Database deployment procedure

Use a deliberate order so schema deployment, service startup, and validation stay safe.

1. Provision the managed PostgreSQL database.
2. Create separate roles:
   - migration role with schema-change privileges
   - runtime role without `BYPASSRLS`
3. Set the runtime `DATABASE_URL` on the backend service.
4. Run the migration job or one-off worker using the migration role.
5. Apply migrations to the final head.
6. Confirm the database head matches the repository head.
7. Run the PostgreSQL-backed validation suite against the staging database.
8. Start the backend with the runtime role and verify `/api/health`.
9. Confirm the application can boot without falling back to SQLite.

Recommended verification commands during deployment:

- `python -m pytest backend/tests/test_seed.py::test_migrations_upgrade_and_seed_on_fresh_database`
- `python -m pytest backend/tests/test_migrations_postgres.py`
- `python -m pytest backend/tests/test_postgres_rls.py`

Do not reuse the runtime role for migrations. Do not grant the runtime role `BYPASSRLS`.

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

The repository already uses route-level code splitting, so no additional staging-only rewrite is required.

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

Staging must use Square Sandbox credentials only. The repository rejects production Square credentials when staging mode is enabled.

## CORS and cookies

Set:

- `FLOWTALLY_ALLOWED_ORIGINS=https://staging.flowtally.ca`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_SAMESITE=Lax`
- `SESSION_COOKIE_HTTPONLY=true` is already enforced by the backend defaults

If the frontend and backend are split across origins, the backend origin must be allowed explicitly and the browser must send credentials.

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

## Manual validation plan

Use two separate tenant fixtures so cross-tenant denial is explicit rather than assumed.

### Tenant A

- Create a prospect organization.
- Complete Google login.
- Finish onboarding.
- Approve launch configuration.
- Activate the organization.
- Validate owner flows, imports, audit activity, and Square mapping against Tenant A only.

### Tenant B

- Create a separate prospect organization.
- Keep it in onboarding or inactive state.
- Attempt to access Tenant A resources.
- Confirm the API denies cross-tenant reads and writes.
- Confirm the UI does not leak Tenant A data into Tenant B views.

### Specific checks to run manually

- Public site loads without exposing customer routes.
- Google login starts and completes with the staging OAuth client.
- Prospect onboarding creates exactly one prospective organization.
- Setup console can configure templates, modules, layouts, custom fields, locations, imports, Square status, blockers, and activation.
- Customer review and approval are recorded.
- Active owner routes remain blocked until activation criteria are satisfied.
- Invitations work only for authorized owners.
- Imports preview without writing, then execute only after approval.
- Support grants show an active banner and are auditable.
- Square Sandbox connection, location mapping, and sync display status and errors clearly.
- Owner audit history filters by actor, entity, location, and date.

## External owner actions still required

These cannot be completed safely from the repository alone:

- A real Google OAuth application and consent screen
- A real Square Sandbox application
- Managed PostgreSQL provisioning
- DNS records for the two staging hostnames, if split-origin hosting is used
- Render service creation and secret entry
- Manual verification using the real staging hostnames

## Remaining blockers

Repository-local work is in good shape. The remaining blockers are external and operational:

- CI has not been executed from this workstation, only reviewed in source form.
- Live Google OAuth and live Square Sandbox access are still externally unverified.
- DNS and Render service setup are still outside the repository.
- Managed PostgreSQL provisioning and backup configuration are still external setup tasks.
