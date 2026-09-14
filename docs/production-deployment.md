# Production deployment runbook

Production is a separate customer environment. During the pre-revenue alpha it uses the existing Aiven PostgreSQL service but a new, empty database named `flowtally_prod`. Staging remains in `defaultdb`. Sharing the Aiven server is allowed temporarily; sharing the database is never allowed.

## Backend

1. Confirm the existing `flowtally_prod` database, `flowtally_prod_migrator`, and `flowtally_prod_runtime` exist on the shared Aiven service.
2. Verify the runtime role has `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT` where supported, and owns neither the database nor protected tables.
3. Set `DATABASE_URL` to `flowtally_prod_runtime` and `FLOWTALLY_MIGRATION_DATABASE_URL` to `flowtally_prod_migrator`; both URLs must target `flowtally_prod`.
4. Configure `FLOWTALLY_ENV=production`, a new `SECRET_KEY`, `FLOWTALLY_RATE_LIMIT_STORAGE_URI`, `FLOWTALLY_ALLOWED_ORIGINS=https://app.flowtally.ca`, and `FLOWTALLY_FRONTEND_ORIGIN=https://app.flowtally.ca`.
5. Configure secure cookies with `SESSION_COOKIE_NAME=flowtally_session`, `SESSION_COOKIE_SECURE=true`, and `SESSION_COOKIE_SAMESITE=Lax`.
6. Configure Google and Square production callbacks from `.env.production.example`.
7. Export `FLOWTALLY_BOOTSTRAP_ADMIN_URL` privately as the `avnadmin` connection to `flowtally_prod`, then run `python scripts/bootstrap_postgres.py --phase provision`. This applies the production role boundary and grants without creating roles or changing passwords.
8. Run `python scripts/bootstrap_postgres.py --phase pre-migrate`, deploy `render.production.yaml`, and let startup run `flask --app backend.wsgi:app db upgrade` before Gunicorn. Alembic uses the migration URL; Flask runtime uses `DATABASE_URL`.
9. Run `python scripts/bootstrap_postgres.py --phase finalize` to reapply safe runtime grants for migration-created objects, then run `python scripts/bootstrap_postgres.py --phase verify`.
10. Confirm `/api/health`, Alembic head, RLS, FORCE RLS, runtime role restrictions, login/logout, and a harmless authenticated read.

Never run the demo seed against production. Never copy staging rows into production. Schema migration is the only automatic startup write expected. Provisioning and finalization are explicit operator commands; application startup does not create roles or grant privileges.

The temporary shared-server arrangement should be replaced with a dedicated production PostgreSQL service when revenue or daily operational dependence begins; application semantics and role separation remain unchanged.

## Role and migration audit

Alembic runs in `backend/migrations/env.py` using `FLOWTALLY_MIGRATION_DATABASE_URL` for PostgreSQL. The Flask engine uses `DATABASE_URL` for application requests. Migrations create schema objects but do not grant runtime privileges or change role membership. The existing staging provisioning SQL names `flowtally_migrator` and `flowtally_runtime`; production uses the separately created `flowtally_prod_migrator` and `flowtally_prod_runtime` without changing migration logic.

The migrator should own migration-created tables or be granted the DDL privileges required by the provider. The runtime role needs schema usage, table DML, sequence usage, and function execution required by the app, but must not own the database, schema, or protected tables. RLS and FORCE RLS remain the database boundary; role membership must not provide a bypass path. `scripts/bootstrap_postgres.py --phase provision` applies these grants and role flags, while `--phase finalize` reapplies the safe grant/default-privilege pass after migrations. If Aiven refuses `ALTER SCHEMA public OWNER`, the command fails with an actionable `aiven_extras`/`claim_public_schema_ownership` message rather than claiming success.

The order is: verify database/roles, run Alembic with the migrator URL, verify runtime grants and ownership, verify RLS/FORCE RLS and policies, then run authenticated application smoke tests.

## Required validation

- `FLOWTALLY_ENV=production` and explicit HTTPS origins
- PostgreSQL, not SQLite
- split-origin CSRF enabled
- secure production cookie name and flag
- Google callback points to `api.flowtally.ca`
- Square callback points to `api.flowtally.ca`
- production Square credentials are distinct from Sandbox/staging
- staging remains on its existing service and database
- `FLOWTALLY_RATE_LIMIT_STORAGE_URI` points to an external Redis/Render Key Value store; memory limiting is not accepted for production because authentication abuse protection must work across restarts/workers
- Square may remain disabled (`SQUARE_ENABLED=false`) for the initial deployment; enable it only after production credentials and webhook configuration exist

