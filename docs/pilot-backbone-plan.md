# Flowtally Pilot Backbone Plan

## Objective

Create the private pilot foundation for one restaurant tenant before adding operational features.

## First milestone

- Flask backend with session auth, organizations, memberships, and locations
- CSRF-protected login/logout/me endpoints
- SQLite-by-default local development database
- Alembic migrations from a clean database
- Seed command for local pilot accounts
- Frontend pilot shell behind `VITE_ENABLE_PILOT_APP`

## Design principles

- Keep the public demo and localStorage workspace unchanged
- Make the pilot app private and disabled by default
- Use one tenant and one location for the first pilot
- Keep the UI simple enough for a restaurant owner to understand quickly

## Non-goals for this milestone

- Invoice workflow
- Inventory workflow
- Reconciliation workflow
- External integrations
- Multi-tenant admin tooling

## Security controls

- Session cookies with HTTPOnly protection
- CSRF for state-changing requests
- Rate-limited login endpoint
- Organization access checks on every tenant-scoped API call

## Deferred work

- Real purchase, inventory, and close workflows in the pilot app
- Billing and notifications
- Production deployment of the pilot backend
