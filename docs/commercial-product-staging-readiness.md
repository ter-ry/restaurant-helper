# Flowtally commercial product staging readiness

Date: 2026-08-10
Branch: `codex/complete-commercial-product-foundation`
Current repository head at the time of this handoff: `f4e454ebcf8d8f0e7dd60eebc7166101d9887ef2`

This is the repository-side staging runbook for the commercial Flowtally app. It assumes the external private-staging resources already exist and that the remaining work is manual owner/bootstrap work, not more product development.

It does not claim that staging has been deployed or live-validated from this workspace.

## Current staging posture

The following external resources already exist:

- Render managed PostgreSQL staging database
- Render Key Value / Redis-compatible rate-limit service
- Render backend service
- Render frontend static site
- `https://staging.flowtally.ca`
- `https://api-staging.flowtally.ca`
- Google staging OAuth project/client
- Google callback: `https://api-staging.flowtally.ca/api/auth/google/callback`
- Square Sandbox application
- Square OAuth callback: `https://api-staging.flowtally.ca/api/integrations/square/callback`
- separate Square Sandbox test seller
- `SECRET_KEY` stored in Render
- `INTEGRATION_ENCRYPTION_KEY` stored in Render
- Google client ID/secret stored in Render
- Square Sandbox application ID/secret stored in Render

Current intentional state:

- `GOOGLE_OIDC_ENABLED=false`
- `SQUARE_ENABLED=false`
- Square webhook not created yet
- `SQUARE_WEBHOOK_SIGNATURE_KEY` not created yet
- support access remains disabled/deferred

## Repository-side staging configuration

### Backend service

`render.pilot-staging.yaml` now deploys only the authenticated commercial backend and runs migrations before starting Gunicorn:

- start command: `flask --app backend.wsgi:app db upgrade && gunicorn backend.wsgi:app --bind 0.0.0.0:$PORT --access-logfile - --error-logfile -`
- health check: `/api/health`
- no legacy root app in the staging blueprint

The backend staging environment is documented in `backend/.env.staging.example` and mirrors the actual split-origin staging layout:

- `FLOWTALLY_ENV=staging`
- `DATABASE_URL=<flowtally_runtime connection URL>`
- `FLOWTALLY_MIGRATION_DATABASE_URL=<flowtally_migrator connection URL>`
- `SECRET_KEY=<strong-random-staging-secret>`
- `FLOWTALLY_ALLOWED_ORIGINS=https://staging.flowtally.ca`
- `SESSION_COOKIE_SECURE=true`
- `SESSION_COOKIE_SAMESITE=Lax`
- `SESSION_COOKIE_NAME=flowtally_pilot_session`
- `FLOWTALLY_ENFORCE_SPLIT_ORIGIN_CSRF=true`
- `FLOWTALLY_RATE_LIMIT_STORAGE_URI=<Render Key Value internal URL>`
- `FLOWTALLY_ALLOW_SQLITE_IN_NONLOCAL=false`
- `MAX_CONTENT_LENGTH=15728640`
- `GOOGLE_OIDC_ENABLED=false`
- `GOOGLE_REDIRECT_URI=https://api-staging.flowtally.ca/api/auth/google/callback`
- `SQUARE_ENABLED=false`
- `SQUARE_ENVIRONMENT=sandbox`
- `SQUARE_REDIRECT_URI=https://api-staging.flowtally.ca/api/integrations/square/callback`
- `SQUARE_WEBHOOK_SIGNATURE_KEY=<not-created-yet>`
- `INTEGRATION_ENCRYPTION_KEY=<strong base64 Fernet key>`

### Frontend static site

Split-origin staging uses:

- frontend: `https://staging.flowtally.ca`
- API base: `https://api-staging.flowtally.ca`

The frontend build reads `VITE_FLOWTALLY_API_BASE_URL`, and `src/lib/apiBase.ts` falls back to the current origin only when that variable is unset. For staging, set:

- `VITE_FLOWTALLY_API_BASE_URL=https://api-staging.flowtally.ca`

### Rate limiting

Staging uses the Render Key Value / Redis-compatible URL through `FLOWTALLY_RATE_LIMIT_STORAGE_URI`.

The backend dependency list now includes the Redis client needed for a `redis://` or `rediss://` storage URL.

## PostgreSQL role separation

The staging database must keep three privilege layers distinct:

### Bootstrap/admin

The initial Render database owner/admin is used only for:

- creating the application roles
- transferring ownership where required
- bootstrap-level grants

It must not become the application runtime identity.

### `flowtally_migrator`

Requirements:

- `LOGIN`
- `NOSUPERUSER`
- `NOBYPASSRLS`
- `NOINHERIT`
- sufficient DDL privileges for Alembic and RLS bootstrap

This role runs migrations and owns migration-created schema objects.

### `flowtally_runtime`

Requirements:

- `LOGIN`
- `NOSUPERUSER`
- `NOBYPASSRLS`
- `NOINHERIT`
- no tenant-table ownership
- only runtime privileges required by the application

This role is the normal Flask application identity and the role used by PostgreSQL RLS/security acceptance tests.

## Staging-safe provisioning script

Use `scripts/provision_postgres_roles_staging.sql` for the real staging database.

It is separate from the CI/test-only script and avoids hardcoded test passwords or `flowtally_test`.

It accepts the actual database name and passwords through `psql -v` variables, and the password values are interpolated safely by `psql` outside any quoted PL/pgSQL block.

Do not echo the passwords back to the terminal or commit them to the repo.

## Verification queries

After running the staging provisioning script, verify the roles and ownership with:

```sql
select rolname, rolsuper, rolbypassrls, rolcanlogin
from pg_roles
where rolname in ('flowtally_migrator', 'flowtally_runtime')
order by rolname;

select
    c.relname,
    pg_get_userbyid(c.relowner) as table_owner,
    c.relrowsecurity,
    c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'suppliers';
```

Expected result:

- both roles are `rolsuper = false`
- both roles are `rolbypassrls = false`
- `suppliers` is not owned by `flowtally_runtime`

## Windows PowerShell staging procedure

Use the following PowerShell sequence when you are ready to bootstrap the real Render staging database.

### 1. Generate strong temporary passwords

```powershell
function New-StrongPassword {
    param([int]$Length = 32)
    $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~'
    $bytes = New-Object byte[] $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

$migratorPassword = New-StrongPassword
$runtimePassword = New-StrongPassword
```

### 2. Fill in the Render PostgreSQL admin connection details

Use the Render dashboard to copy the admin connection for the staging database. Keep the values local only.

```powershell
$databaseName = '<staging database name>'
$dbHost = '<render-postgres-host>'
$dbPort = '<port>'
$dbAdminUser = '<render-admin-user>'
$dbAdminPassword = '<render-admin-password>'
```

### 3. Run the provisioning script

```powershell
$env:PGPASSWORD = $dbAdminPassword
psql -X -v ON_ERROR_STOP=1 `
  -v database_name=$databaseName `
  -v migrator_password=$migratorPassword `
  -v runtime_password=$runtimePassword `
  -f scripts/provision_postgres_roles_staging.sql `
  -h $dbHost `
  -p $dbPort `
  -U $dbAdminUser `
  -d $databaseName
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
```

### 4. Build the migrator and runtime URLs

Use the passwords you generated in step 1.

```powershell
$migratorUrl = "postgresql+psycopg2://flowtally_migrator:$migratorPassword@$dbHost:$dbPort/$databaseName"
$runtimeUrl = "postgresql+psycopg2://flowtally_runtime:$runtimePassword@$dbHost:$dbPort/$databaseName"
```

### 5. Save the URLs in Render

Set these on the backend service:

- `FLOWTALLY_MIGRATION_DATABASE_URL = $migratorUrl`
- `DATABASE_URL = $runtimeUrl`
- `FLOWTALLY_RATE_LIMIT_STORAGE_URI = <Render Key Value internal URL>`

Keep the two database URLs separate:

- `FLOWTALLY_MIGRATION_DATABASE_URL` is for migrations and bootstrap DDL.
- `DATABASE_URL` stays the runtime/application connection used by Flask.

Leave these disabled for this staging pass:

- `GOOGLE_OIDC_ENABLED = false`
- `SQUARE_ENABLED = false`

### 6. Run the migration command

`backend/migrations/env.py` now explicitly prefers `FLOWTALLY_MIGRATION_DATABASE_URL` during migration execution, so this command is safe for staging migrations:

```powershell
flask --app backend.wsgi:app db upgrade
```

To confirm the connection split after the migration:

```powershell
flask --app backend.wsgi:app db current
```

The migration path should resolve as `flowtally_migrator`, while the running backend uses `flowtally_runtime`.

## Migration procedure

Alembic already uses `FLOWTALLY_MIGRATION_DATABASE_URL` when it is set, while the running Flask application uses `DATABASE_URL`.

The safe staging order is:

1. Use the bootstrap/admin connection once to create roles and apply ownership/grants.
2. Run migrations with `flowtally_migrator` using `flask --app backend.wsgi:app db upgrade`.
3. Start the backend with `flowtally_runtime`.
4. Confirm `/api/health`.

Do not run migrations under the runtime role.
For staging or any similar production-like deployment, chain `db upgrade` before Gunicorn so a new release does not boot against an older schema.

## Exact Render configuration summary

### Backend Render service

- Build command: `pip install -r backend/requirements.txt`
- Start command: `flask --app backend.wsgi:app db upgrade && gunicorn backend.wsgi:app --bind 0.0.0.0:$PORT --access-logfile - --error-logfile -`
- Health check: `/api/health`
- `FLOWTALLY_ENV=staging`
- `SESSION_COOKIE_SECURE=true`
- `FLOWTALLY_ALLOWED_ORIGINS=https://staging.flowtally.ca`
- `FLOWTALLY_RATE_LIMIT_STORAGE_URI=<Render Key Value internal URL>`
- `GOOGLE_OIDC_ENABLED=false`
- `SQUARE_ENABLED=false`

### Frontend Render static site

- `VITE_FLOWTALLY_API_BASE_URL=https://api-staging.flowtally.ca`

### Google callback

- `https://api-staging.flowtally.ca/api/auth/google/callback`

### Square Sandbox callback/webhook

- OAuth callback: `https://api-staging.flowtally.ca/api/integrations/square/callback`
- Webhook: not created yet

## Backup and restore

Before first customer onboarding, staging should have:

- automated database backups enabled
- a documented restore test
- a rollback test against the current migration head

## Platform-admin bootstrap

The internal setup console requires a user with the `setup_admin` platform role.

Bootstrap approach:

1. Create a normal Flowtally user through the Google login flow.
2. Grant the `setup_admin` platform role in the staging database.
3. Confirm the user can open `/setup`.

Keep the bootstrap path restricted to staff only.

## Final mutation UX audit checklist

Before first customer release, audit every customer-facing and operator-facing mutation surface for:

- silent save buttons
- stale state after successful writes
- missing loading states
- missing success confirmation
- missing error states
- duplicate-submit risk
- UI values that only become correct after manual refresh
- dependent cards, KPIs, and checklists that do not update after writes
- stale data after returning to a tab or page
- any place where a hard browser refresh is unnecessarily required

## Manual validation plan

Use two separate tenant fixtures so cross-tenant denial is explicit rather than assumed.

### Tenant A

- create a prospect organization
- complete Google login
- finish onboarding
- approve launch configuration
- activate the organization
- validate owner flows, imports, audit activity, and Square mapping against Tenant A only

### Tenant B

- create a separate prospect organization
- keep it in onboarding or inactive state
- attempt to access Tenant A resources
- confirm the API denies cross-tenant reads and writes
- confirm the UI does not leak Tenant A data into Tenant B views

## External owner actions still required

The remaining work before a first private staging deployment is manual and external:

- provision the real managed PostgreSQL roles using the staging script
- set the backend runtime and migration URLs in Render
- set the frontend API base URL in the static site service
- run migrations using `flowtally_migrator`
- restart/deploy the backend with `flowtally_runtime`
- confirm `https://api-staging.flowtally.ca/api/health`
- create the Square webhook only when Square is intentionally enabled later

## NEXT OWNER ACTION

1. Provision the staging PostgreSQL roles with `scripts/provision_postgres_roles_staging.sql`.
2. Set `FLOWTALLY_MIGRATION_DATABASE_URL` and `DATABASE_URL` in Render.
3. Set `VITE_FLOWTALLY_API_BASE_URL=https://api-staging.flowtally.ca` on the frontend static site.
4. Run `flask --app backend.wsgi:app db upgrade`.
5. Restart the backend and verify `/api/health`.
