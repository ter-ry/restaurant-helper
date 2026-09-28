# Private writable showcase

The private showcase is a separate staging deployment for owner walkthroughs. It
uses the same application and migrations as production, but a dedicated database,
runtime role, migrator role, session cookie, origins, rate-limit store and OAuth
credentials. It is deliberately separate from the read-only public demo.

## Provisioning

1. Create an isolated PostgreSQL database named by `FLOWTALLY_SHOWCASE_DATABASE_NAME`.
2. Create separate runtime and migrator roles. The runtime role must retain the
   normal tenant RLS restrictions; the migrator owns only migration objects.
3. Configure the secrets in `render.showcase.yaml` from `.env.showcase.example`.
   Never copy production, staging, Square production, or public-demo credentials.
4. Set the canonical `SQUARE_WEBHOOK_NOTIFICATION_URL` to the deployed API URL
   and register the matching OAuth callback in Square Sandbox.
5. Run the operator command from the showcase service only:

   ```text
   flask --app backend.wsgi:app showcase-reset --confirm-showcase --database-name flowtally_showcase
   ```

The command refuses production, `defaultdb`, an unnamed database, a mismatched
database, or any environment without `FLOWTALLY_SHOWCASE_ENABLED=true`. It
clears and reseeds the selected showcase database idempotently and never exposes
or accepts a reset HTTP endpoint.

## Square Sandbox checklist

- Create or select the existing Square application in **Sandbox**.
- Add the exact showcase OAuth callback URL and webhook notification URL.
- Enable the catalog and order webhook subscriptions handled by this repository
  (verify the current event names in the Square Console before saving).
- Store the Sandbox application ID, secret, webhook signature key and a fresh
  integration encryption key only in the showcase service.
- Review the current requested scopes (`MERCHANT_PROFILE_READ`, `ITEMS_READ`,
  `ITEMS_WRITE`, `ORDERS_READ`, `ORDERS_WRITE`) with the merchant owner before
  authorizing; no production merchant is required for this environment.

OCR.Space is similarly opt-in through the showcase-only API key and endpoint
settings. The public read-only demo intentionally has no OCR provider key.
