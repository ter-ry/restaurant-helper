# Official restaurant sales demo

The repository's official sales story is the **Harbour Kitchen** profile: a
fictional Toronto restaurant using the existing pilot API and the existing
read-only public demo UI. `seed-demo` is the only supported way to create the
database-backed profile.

## Safe architecture

Run the demo as a separate Render service and separate database. Use a unique
database, runtime role, migration role, session-cookie name, frontend origin,
and API origin. The demo must never point at `flowtally_prod`, `defaultdb`, a
customer organization, or a real Square connection. The lowest-cost safe
deployment is a small Render service plus an isolated managed PostgreSQL
database; a temporary Render URL is sufficient while validating the demo.

Set `FLOWTALLY_DEMO_READ_ONLY=true` and `SQUARE_ENABLED=false`. Keep the
production commercial gate and platform-admin routes unchanged. The server
rejects every non-authentication API write with HTTP 403, so disabled buttons
are only a usability aid.

## Seed command

Run against the isolated demo database after migrations:

```text
flask --app backend.wsgi:app seed-demo --profile casual_restaurant
```

The command refuses `FLOWTALLY_ENV=production`, validates the selected
environment before writing, and is safe to rerun. It creates Harbour Kitchen,
Toronto location data, suppliers, invoices and receiving movements, recipes
with ingredient costing, menu items, stock counts, reorder signals, waste, a
completed and an open Daily Close, and synthetic Square catalog/order history.
Square rows are explicitly marked as demo data and contain no token or merchant
credential. `--reset` is intentionally refused; reset a disposable demo
database by recreating that database rather than risking another environment.

## Story and expected walkthrough

The seeded profile shows a chicken price increase, low-stock ingredients,
count variance, spoilage waste, recipe-linked menu costing, one unmapped
seasonal Square variation, several days of synthetic sales, and a completed
close. The existing calculations consume the seeded records; no KPI is
hard-coded by the demo seed.

## Manual launch steps and cost

Create the isolated database/service, set the variables above, run migrations,
run `seed-demo`, and configure the temporary frontend/API origins. Add
`demo.flowtally.ca` only after the walkthrough is accepted. Do not reuse
production OAuth, Square, OCR, encryption, or database secrets. Expect the
incremental cost to be the chosen database plan plus any Render service fee;
the repository does not provision or purchase those resources automatically.

The demo is repository-ready, but it is not publicly shareable until that
isolated service/database and its authentication entry point are deployed and
smoke-tested.
