# Production deployment runbook

Production is a separate customer environment. It must use a new, empty PostgreSQL database and must never reuse the staging database or staging credentials.

## Backend

1. Create a managed PostgreSQL service and a separate migration/admin role.
2. Create a runtime role with `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT` where supported by the provider, and no ownership of protected application tables.
3. Set `DATABASE_URL` to the runtime role and `FLOWTALLY_MIGRATION_DATABASE_URL` to the migration role.
4. Configure `FLOWTALLY_ENV=production`, a new `SECRET_KEY`, `FLOWTALLY_RATE_LIMIT_STORAGE_URI`, `FLOWTALLY_ALLOWED_ORIGINS=https://app.flowtally.ca`, and `FLOWTALLY_FRONTEND_ORIGIN=https://app.flowtally.ca`.
5. Configure secure cookies with `SESSION_COOKIE_NAME=flowtally_session`, `SESSION_COOKIE_SECURE=true`, and `SESSION_COOKIE_SAMESITE=Lax`.
6. Configure Google and Square production callbacks from `.env.production.example`.
7. Deploy `render.production.yaml`. Startup must run `flask --app backend.wsgi:app db upgrade` before Gunicorn.
8. Confirm `/api/health`, Alembic head, RLS, FORCE RLS, runtime role restrictions, login/logout, and a harmless authenticated read.

Never run the demo seed against production. Never copy staging rows into production. Schema migration is the only automatic startup write expected.

## Required validation

- `FLOWTALLY_ENV=production` and explicit HTTPS origins
- PostgreSQL, not SQLite
- split-origin CSRF enabled
- secure production cookie name and flag
- Google callback points to `api.flowtally.ca`
- Square callback points to `api.flowtally.ca`
- production Square credentials are distinct from Sandbox/staging
- staging remains on its existing service and database

