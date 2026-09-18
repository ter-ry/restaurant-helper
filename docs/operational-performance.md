# Operational performance change

This branch contains an opt-in diagnostic layer and safe read-path batching. It does not change worker counts, pool size, deployment settings, demo data, production data, or paid resources.

## Acceptance checklist

- Exact page endpoints identified: `/api/integrations/square/status`, `/api/integrations/square/catalog/mappings`, `/api/pilot/menu-costing`, `/api/integrations/square/usage`, `/api/pilot/inventory/count-sessions`, `/api/pilot/dashboard`, `/api/pilot/inventory`, `/api/auth/me`, `/api/organizations/current`, and `/api/pilot/attention`.
- Warm live baseline recorded before this branch: Square status 5.51s; mappings 8.98s; usage 14.52s; count sessions 1.80s; dashboard 2.16s; inventory 2.20s. A queue probe showed mappings 9.01s, then health 9.40s and auth 10.90s when submitted behind it.
- Render cold starts documented separately. No cold sample was claimed because the instance stayed active; Render Free sleep remains an infrastructure limitation.
- Local same-fixture benchmark runs ten warm samples per endpoint and counts SQL statements. Local timings are not presented as Render timings.
- Local SQL counts reduced: status 56→22, menu costing 62→12, mappings 101→29, usage 200→44. The usage baseline uses the fixed benchmark date range; the earlier live-like range measured 188 statements.
- Before/after JSON outputs for every endpoint were compared and matched on the seeded fixture.
- Usage / Variance now starts mappings and usage concurrently, reports independent errors, and ignores stale completions after its request inputs change.
- RLS, permission checks, and read-only demo behavior remain in the existing request path; targeted security and endpoint regression tests pass.

## Implementation

`backend/square_integration.py` now batches catalog mapping and sold-unit aggregation, preloads catalog parents, eager-loads order lines and mapped menu recipes, batches stock-count snapshots/movement totals, and reuses those values during one usage report. `backend/pilot_api.py` eager-loads recipe ingredients and inventory items for menu costing.

`backend/performance.py` is opt-in. It emits request-scoped `Server-Timing` and structured application logs containing only a request trace ID, endpoint name, status, durations, SQL count, keyed query-group IDs, and connection-acquisition counters. It never logs SQL text, parameter values, credentials, tokens, session contents, or response data. Enable only in isolated demo/test configuration with `FLOWTALLY_PERFORMANCE_DIAGNOSTICS=true`; production-like environments keep it disabled by default.

The diagnostics can measure application/handler time, SQL execution time, statement count, stable privacy-safe slow query-group IDs, and SQLAlchemy pool acquisition time. Queue time is only recorded when a trusted WSGI adapter supplies `flowtally.request_received_at` in the WSGI environ; client-controlled headers are ignored. Gunicorn worker queue time is therefore not claimed measured by this code. The prior live queue evidence remains valid.

## Verification

The local benchmark is `scripts/benchmark_operational.py`. It refuses to seed an existing fixture, clears inherited deployment configuration, uses a disposable SQLite fixture, and records no response bodies in its timing samples. Run it twice against the same fixture before and after a revision, then compare the summaries and snapshots.

The checked-in fixture summary is in `docs/operational-performance-results.md`; it records the exact SQL-count and optimized timing values used in this PR.

Targeted frontend tests: 23 files, 96 tests passed, including a regression test that holds usage open while mappings render. Backend query-count and Square security tests passed (1 and 2 tests respectively); the broader pilot API suite requires the repository PostgreSQL service in this Windows environment. Typecheck, Vite build, and lint complete; lint retains pre-existing warnings only. The benchmark's optional `--concurrent` probe records an in-process fixture result and explicitly does not model Gunicorn scheduling or Render worker capacity.

The live demo was not redeployed from this branch, so a post-change Render measurement is intentionally not claimed. The remaining acceptance step is to run the same warm and concurrent endpoint probe against an authorized staging deployment of this branch, then compare live `Server-Timing` fields and request IDs. No production deployment is needed.
