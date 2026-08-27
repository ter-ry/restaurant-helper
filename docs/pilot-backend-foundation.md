# Flowtally Pilot Backend Foundation

## Application boundaries

- Legacy root Flask app: `app.py`
- Authenticated pilot backend: `backend.wsgi:app`
- Public demo frontend: the default Vite app under `src/`
- Private pilot frontend: `src/pilot/`

## Local startup

1. Install backend dependencies from `backend/requirements.txt`.
2. Run migrations with `flask --app backend.wsgi db upgrade`.
3. Seed local pilot data with `flask --app backend.wsgi seed pilot`.
4. Start the pilot backend with `flask --app backend.wsgi run --host 127.0.0.1 --port 5001`.
5. Start the frontend with `npm.cmd run dev`.

## Environment modes

- Development and test can use SQLite and in-memory rate-limit storage.
- Staging and production must set `FLOWTALLY_ENV`, `SECRET_KEY`, `DATABASE_URL`, `FLOWTALLY_ALLOWED_ORIGINS`, `SESSION_COOKIE_SECURE`, and `FLOWTALLY_RATE_LIMIT_STORAGE_URI`.
- Staging and production refuse weak secrets, SQLite databases, wildcard CORS, and insecure cookies unless an explicit emergency override is set.

## Organization and location selection

- A user with one membership is auto-selected.
- A user with multiple memberships must choose the active organization.
- Organization selection uses `POST /api/organizations/select`.
- Location selection uses `POST /api/locations/select`.
- The browser cannot select an organization or location by itself without the server confirming membership.

## Authorization

- Owners can do everything in the current pilot scope.
- Managers can do day-to-day operational work: suppliers, inventory, purchases, stock counts, and reorder plans.
- Organization settings, membership management, and audit viewing are owner-only.

## Audit logging

- Audit events are stored in `audit_events`.
- Recorded fields include organization, location, actor, event type, entity type, entity id, request id, source IP, user agent summary, metadata, and server timestamps.
- Audit entries are append-only.

## Tenant isolation

- Pilot queries are scoped by organization and, where relevant, location.
- Session selection is cleared if it no longer matches the authenticated user.
- The backend still depends on application-level enforcement for most tenant boundaries, and PostgreSQL row-level security is enabled for the commercial staging path.

## Migrations

- Create new migrations with `flask --app backend.wsgi db migrate`.
- Upgrade a database with `flask --app backend.wsgi db upgrade`.
- Inspect the active revision with `flask --app backend.wsgi db current`.

## Validation

- Backend tests: `python -m pytest backend/tests`
- Root Python tests: `python -m unittest discover -s tests`
- Frontend build: `npm.cmd run build`

## Staging readiness

- Repository staging config lives in `render.pilot-staging.yaml`.
- The staging Render start command runs `flask --app backend.wsgi:app db upgrade` before Gunicorn so a new deploy does not boot against an older schema.
- Use a managed PostgreSQL `DATABASE_URL` and explicit staging origins.
- Do not deploy from the repository unless the owner has asked for deployment.

## Remaining limitations

- No full membership administration UI yet.
- No POS, accounting, or scheduling backend.
- The legacy root app is not part of the commercial staging blueprint.
