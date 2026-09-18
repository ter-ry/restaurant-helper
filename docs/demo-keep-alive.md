# Demo backend keep-alive

The public demo backend is `https://flowtally-api-demo.onrender.com`. The workflow only requests its lightweight `/api/health` endpoint. It never contacts the frontend, production, staging, a customer backend, or a database endpoint.

The workflow is **OFF by default**. Scheduled runs have a job-level guard and allocate no GitHub runner unless the repository variable `DEMO_KEEP_ALIVE_ENABLED` is exactly `true` (lowercase). Missing, empty, or any other value keeps it off. A manual warm-up is always one bounded request and does not enable recurring traffic.

## Before a demo

1. In GitHub, open **Settings → Secrets and variables → Actions → Variables**.
2. Create or edit the repository variable `DEMO_KEEP_ALIVE_ENABLED` with value `true`.
3. Open **Actions → Demo backend keep-alive → Run workflow**, choose `warm-up`, and run it.
4. Wait for the successful health response, then open the demo.

## After a demo

Change `DEMO_KEEP_ALIVE_ENABLED` to `false` (or remove it). Future scheduled jobs are skipped before a runner is allocated. An already-running request may finish; switching off does not forcibly suspend Render.

The schedule is approximately every ten minutes and GitHub scheduling is best effort. The workflow uses a 90-second request timeout, one bounded retry, a three-minute job timeout, and a concurrency group so requests cannot overlap.

## Free-tier usage

Render documents 750 free instance hours per workspace per calendar month. A free web service spins down after 15 minutes without inbound traffic, and a running free web service consumes instance hours. A static site is not a free web service instance, so this workflow only affects the backend service. Approximate backend consumption for one demo session is:

| Demo duration | Backend instance hours |
| ---: | ---: |
| 1 hour | 1 hour |
| 2 hours | 2 hours |
| 4 hours | 4 hours |

Keeping the backend warm continuously for a full month would consume about 720 hours, leaving little of the 750-hour workspace allowance for other free web services. Keep-alive OFF after the walkthrough lets the service return to normal idle suspension. A health ping does not fix slow SQL, worker contention, or cold-start time; it only reduces the chance of an idle suspension during a planned demo.

This feature requires one-time repository-variable setup. It does not require a personal access token, paid scheduler, Render plan change, database change, or application environment-variable change.

References: [Render free instance limits](https://render.com/docs/free), [GitHub Actions variables](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables), and [workflow job conditions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idif).
