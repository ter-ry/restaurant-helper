# External launch checklist

This checklist contains placeholders only. Never paste secrets into the repository or into chat.

## A. Database provider

- Use the existing Aiven service only as a temporary shared host: staging is `defaultdb`; production is `flowtally_prod`.
- Confirm `flowtally_prod_migrator` and `flowtally_prod_runtime` exist.
- Set `DATABASE_URL` to the runtime role and `FLOWTALLY_MIGRATION_DATABASE_URL` to the migration role; both must target `flowtally_prod`.
- Runtime role must be non-superuser, `NOBYPASSRLS`, and must not own protected tables.
- Success: migrations reach the current Alembic head and catalog checks show RLS/FORCE RLS.
- Stop if either URL contains `/defaultdb` or the database names differ.

## B. Render/backend

- Create service `flowtally-api-production` from `render.production.yaml`.
- Hostname: `api.flowtally.ca`.
- Set `FLOWTALLY_ENV=production`, `FLOWTALLY_FRONTEND_ORIGIN=https://app.flowtally.ca`, and the production rate-limit store.
- Do not reuse staging `DATABASE_URL`, `SECRET_KEY`, cookie name, OAuth credentials, or Square secrets.
- Success: `/api/health` is healthy and startup logs show migration then Gunicorn.
- Run `python scripts/production_preflight.py` locally before saving Render variables.

## C. Frontend hosting

- Create the production build with `VITE_ENABLE_PILOT_APP=true` and `VITE_PILOT_API_BASE_URL=https://api.flowtally.ca`.
- Host the build at `app.flowtally.ca`.
- Success: browser requests use `api.flowtally.ca`, never `api-staging.flowtally.ca`.

## D. Porkbun DNS

- Add the hosting provider’s required CNAME/ALIAS for `app.flowtally.ca`.
- Add the Render custom-domain CNAME for `api.flowtally.ca`.
- Keep `flowtally.ca` and `www.flowtally.ca` on the marketing site.
- Success: HTTPS certificates issue for all three intended hostnames.

## E. Google OAuth console

- Add authorized redirect URI `https://api.flowtally.ca/api/auth/google/callback`.
- Add the production web origin `https://app.flowtally.ca`.
- Generate a production client secret; do not reuse staging’s client secret.
- Success: Google login returns to `https://app.flowtally.ca/app/dashboard`.

## F. Square Developer dashboard

- Configure the production application and callback `https://api.flowtally.ca/api/integrations/square/callback`.
- Configure the production webhook URL using the deployed integration route and production signature key.
- Generate production credentials; never reuse Sandbox credentials.
- Success: connection, catalog sync, mapping, and orders operate against the intended merchant.

## G. Demo environment

- Create separate service `flowtally-api-demo`, database, cookie `flowtally_demo_session`, and origins `https://demo.flowtally.ca` / `https://api-demo.flowtally.ca`.
- Set `FLOWTALLY_DEMO_READ_ONLY=true`, `SQUARE_ENABLED=false`, and no OCR provider credentials.
- Run `seed-demo` only against this database.
- Success: reads work, every non-auth API write returns HTTP 403, and demo data is isolated from production.

## H. Final smoke testing

- Verify production login/logout, dashboard, purchase read, inventory read, Square callback, and health.
- Verify demo read-only behavior with a direct API write attempt.
- Verify staging still points to its existing host/database and retains its existing cookie name.
- Record the production Alembic head, runtime role flags, callback URLs, and final smoke-test timestamp.
