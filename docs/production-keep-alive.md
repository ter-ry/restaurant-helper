# Production backend keep-alive

The Production backend is `https://flowtally-api-production.onrender.com`. The exact keep-alive target is `https://flowtally-api-production.onrender.com/api/health`. This workflow only requests that lightweight health endpoint. It never contacts the frontend, authenticated routes, Square, a database endpoint, or the custom API domain.

The workflow is **OFF by default**. Scheduled runs have a job-level guard and allocate no GitHub runner unless the repository variable `PRODUCTION_KEEP_ALIVE_ENABLED` is exactly `true` (lowercase). Missing, empty, or any other value keeps it off. The Production toggle is independent from `DEMO_KEEP_ALIVE_ENABLED`.

## Enable temporarily for recording testing

1. In GitHub, open **Settings → Secrets and variables → Actions → Variables**.
2. Create or edit `PRODUCTION_KEEP_ALIVE_ENABLED` with value `true`.
3. Open **Actions → Production backend keep-alive → Run workflow**.
4. Choose `warm-up` and run the workflow. This sends exactly one health request; it does not enable recurring traffic.
5. Wait for the successful warm-up, then perform the showcase rehearsal.

The scheduled job runs approximately every ten minutes at minutes 7, 17, 27, 37, 47, and 57. Each request has a 90-second timeout, at most one retry, and a three-minute job timeout. The concurrency group prevents overlapping keep-alive jobs.

## Disable after testing

Change `PRODUCTION_KEEP_ALIVE_ENABLED` to value `false` (or remove it). Future scheduled jobs are skipped before a runner is allocated. An already-running request may finish; disabling the variable does not forcibly suspend Render.

This workflow does not change Render configuration, DNS, Cloudflare, credentials, Production data, Square data, or the demo keep-alive workflow.
