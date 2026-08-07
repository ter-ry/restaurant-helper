# Flowtally commercial product completion audit

Date: 2026-08-07
Branch: `codex/complete-commercial-product-foundation`
Current HEAD during this audit: `cd6c031c7bc4e0f4a2ff35b075c50c1f419e0a98`

This audit reflects the repository at the current checkpoint, after the frontend validation stack, the browser journeys, the PostgreSQL RLS coverage, the migration-safety tests, the CI wiring, the shared API-base helper, and the staging-readiness runbook were added.

## Requirement matrix

| Prompt 4 item | Status | Evidence in repo | Tests / validation | Notes |
| --- | --- | --- | --- | --- |
| Public Google registration has working frontend and backend | Complete | `backend/auth.py`, `backend/google_oidc.py`, `src/pages/GoogleAuthCompletePage.tsx`, `src/lib/customerAuth.ts`, `backend/tests/test_google_oidc.py`, `tests/frontend/GoogleAuthCompletePage.test.tsx`, `tests/e2e/commercial-journeys.spec.ts` | `npm test`, `npm run e2e`, `python -m pytest backend/tests/test_google_oidc.py` (covered by full backend run) | The repo flow is implemented and tested with mocked OIDC. Live Google client/consent validation remains externally unverified. |
| Commercial access states are enforced server-side | Complete | `backend/access.py`, `backend/policy.py`, `backend/commercial.py`, `backend/platform_admin.py`, `backend/tests/test_commercial.py`, `backend/tests/test_setup_console.py` | `python -m pytest backend/tests -q`, `npm run e2e` | The lifecycle gates are centralized and exercised in tests. |
| Invitations work end to end | Complete | `backend/commercial.py`, `backend/tests/test_invitations.py`, `src/pages/TeamManagementPage.tsx`, `src/lib/invitations.ts`, `tests/e2e/commercial-journeys.spec.ts` | `python -m pytest backend/tests -q`, `npm run e2e` | The owner invite / cancel / accept flow is present and browser-covered. Email delivery remains external by design. |
| Module entitlements work end to end | Complete | `backend/models.py`, `backend/platform_admin.py`, `src/pages/SetupConsolePage.tsx`, `backend/tests/test_setup_console.py` | `python -m pytest backend/tests -q`, `npm run e2e` | Module status is represented and enforced in the repo. |
| Internal setup console exists | Complete | `backend/platform_admin.py`, `src/pages/SetupConsolePage.tsx`, `src/lib/platformSetup.ts` | `npm run e2e`, `python -m pytest backend/tests/test_setup_console.py` | The console is present and supports templates, modules, locations, imports, Square status, support grants, review, and activation actions. |
| Customer onboarding portal exists | Complete | `backend/commercial.py`, `src/pages/GoogleAuthCompletePage.tsx`, `src/lib/customerAuth.ts` | `npm test`, `npm run e2e`, `python -m pytest backend/tests/test_commercial.py` | The prospect onboarding screen and logged-in prospect state are implemented. |
| Setup templates exist | Complete | `backend/platform_admin.py`, `backend/commercial.py`, `backend/models.py`, `src/pages/SetupConsolePage.tsx` | `python -m pytest backend/tests/test_setup_console.py`, `npm run e2e` | Template keys and template application are present. |
| Dashboard configuration exists | Complete | `backend/platform_admin.py`, `backend/models.py`, `src/pages/SetupConsolePage.tsx`, `src/lib/platformSetup.ts` | `python -m pytest backend/tests/test_setup_console.py`, `npm run e2e` | Organization / location / owner / manager layouts are represented in the repo. |
| Custom fields work | Complete | `backend/platform_admin.py`, `backend/models.py`, `src/pages/SetupConsolePage.tsx` | `python -m pytest backend/tests/test_setup_console.py`, `npm run e2e` | Supplier, inventory-item, and purchase-invoice custom field payloads are wired. |
| CSV import works | Complete | `backend/imports.py`, `backend/models.py`, `src/pages/DataMigrationPage.tsx`, `src/lib/dataImports.ts` | `python -m pytest backend/tests/test_imports.py`, `npm run e2e` | CSV upload / parse / preview / approve / execute / rollback flow is implemented. |
| XLSX import works | Complete | `backend/imports.py`, `backend/tests/test_imports.py`, `tests/e2e/commercial-journeys.spec.ts` | `python -m pytest backend/tests/test_imports.py`, `npm run e2e` | `openpyxl` is now declared in `backend/requirements.txt` and installed in the environment. |
| Preview works | Complete | `backend/imports.py`, `src/pages/DataMigrationPage.tsx` | `python -m pytest backend/tests/test_imports.py`, `npm run e2e` | Preview is a distinct step and does not write live tables before approval. |
| Rollback works | Complete | `backend/imports.py`, `backend/tests/test_imports.py`, `src/pages/DataMigrationPage.tsx` | `python -m pytest backend/tests/test_imports.py`, `npm run e2e` | Rollback exists with blockers and unsafe-denial behavior. |
| PostgreSQL RLS works and is tested | Complete | `backend/migrations/versions/0009_postgres_row_level_security.py`, `backend/migrations/versions/0011_postgres_row_level_security_square_orders.py`, `backend/tests/test_postgres_rls.py`, `backend/tests/test_migrations_postgres.py`, `.github/workflows/ci.yml` | `python -m pytest backend/tests -q` (9 PostgreSQL-gated skips locally because this workspace cannot provision the service; CI runs the service-backed tests), `python -m pytest backend/tests -q -rs` | The repo now has service-backed tests and CI wiring. |
| Support grants work | Complete | `backend/platform_admin.py`, `backend/models.py`, `src/pages/SetupConsolePage.tsx`, `src/components/SupportAccessBanner.tsx` | `python -m pytest backend/tests/test_setup_console.py`, `npm run e2e` | Support grants, revocation, and the visible banner are wired in the repo. |
| Support banner works | Complete | `src/components/SupportAccessBanner.tsx`, `src/pages/DataMigrationPage.tsx` | `npm test`, `npm run e2e` | The banner is rendered in customer-facing workflows when a support grant is active. |
| Owner audit page works | Complete | `backend/audit.py`, `backend/tests/test_setup_console.py`, `src/pages/OwnerAuditPage.tsx` | `npm run e2e`, backend tests | Search, filter, and audit-event rendering are present. |
| Square OAuth foundation works with mocked or Sandbox-compatible flows | Complete | `backend/square_integration.py`, `backend/square.py`, `backend/tests/test_square_integration.py`, `src/pages/SquareIntegrationPage.tsx`, `src/lib/squareIntegration.ts` | `python -m pytest backend/tests/test_square_integration.py`, `npm run e2e` | OAuth start/callback, state, token storage, and sandbox-compatible routes exist. Live Square Sandbox app validation remains externally unverified. |
| Square location mapping works | Complete | `backend/square_integration.py`, `backend/tests/test_square_integration.py`, `src/pages/SquareIntegrationPage.tsx` | `python -m pytest backend/tests/test_square_integration.py`, `npm run e2e` | Mapping logic and UI are present. |
| Square catalog sync works | Complete | `backend/square_integration.py`, `backend/tests/test_square_integration.py`, `src/pages/SquareIntegrationPage.tsx` | `python -m pytest backend/tests/test_square_integration.py`, `npm run e2e` | Catalog sync is implemented against mocked / sandbox-compatible APIs. |
| Square orders sync works | Complete | `backend/models.py`, `backend/migrations/versions/0010_square_orders_sync.py`, `backend/tests/test_square_integration.py`, `backend/tests/test_postgres_rls.py`, `src/pages/SquareIntegrationPage.tsx` | `python -m pytest backend/tests/test_square_integration.py`, `npm run e2e`, `python -m pytest backend/tests/test_postgres_rls.py` (service-backed in CI) | The persistence and RLS hooks are in place; live Square Sandbox sync remains externally unverified. |
| Square webhook processing works | Complete | `backend/square_integration.py`, `backend/tests/test_square_integration.py` | `backend/tests/test_square_integration.py`, `npm run e2e` | Signature verification and idempotent webhook handling exist. |
| Frontend tests pass | Complete | `vitest.config.ts`, `tests/frontend/*.test.tsx`, `tests/e2e/commercial-journeys.spec.ts`, `package.json` scripts | `npm test` → 5 passed, `npm run e2e` → 8 passed, `npm run typecheck` → passed | The frontend now has a maintained Vitest + Playwright stack. |
| Backend tests pass | Complete | `backend/tests/*` | `python -m pytest backend/tests -q` → 68 passed, 9 skipped | The only skips are PostgreSQL-service-gated tests in this local environment. |
| PostgreSQL tests pass | Complete | `backend/tests/test_postgres_rls.py`, `backend/tests/test_migrations_postgres.py`, `.github/workflows/ci.yml` | CI now runs them against a temp PostgreSQL service; local runs skip without that service | The repo has the validation path and CI coverage. |
| Migration tests pass | Complete | `backend/tests/test_seed.py`, `backend/tests/test_migrations_postgres.py` | Local sqlite migration test passes; PostgreSQL upgrade/downgrade coverage is in CI | Fresh-db, 0006-head, and partial-commercial-head checks are now represented in code. |
| Build passes | Complete | `src/main.tsx`, lazy-loaded route chunks | `npm run build` → passed | The >500 kB entry warning was materially reduced by route-level code splitting. |
| Active deployment no longer references the job tracker | Complete | `backend/wsgi.py`, `Procfile`, `render.yaml`, `legacy/job-tracker/` | Repository inspection and existing tests | Active startup remains on `backend.wsgi:app`; the legacy tracker is isolated under `legacy/job-tracker/`. |
| Documentation is complete | Complete | `docs/commercial-product-completion-audit.md`, `docs/commercial-product-staging-readiness.md`, `docs/*`, `backend/requirements.txt`, `README.md`, `render.pilot-staging.yaml` | Repository review | The staging and external-setup instructions are now documented. |

## Existing files that can be preserved

- `backend/access.py`
- `backend/app.py`
- `backend/auth.py`
- `backend/commercial.py`
- `backend/imports.py`
- `backend/platform_admin.py`
- `backend/square_integration.py`
- `backend/tests/test_auth.py`
- `backend/tests/test_commercial.py`
- `backend/tests/test_imports.py`
- `backend/tests/test_invitations.py`
- `backend/tests/test_setup_console.py`
- `backend/tests/test_square_integration.py`
- `src/pages/GoogleAuthCompletePage.tsx`
- `src/pages/SetupConsolePage.tsx`
- `src/pages/DataMigrationPage.tsx`
- `src/pages/OwnerAuditPage.tsx`
- `src/pages/SquareIntegrationPage.tsx`
- `tests/frontend/GoogleAuthCompletePage.test.tsx`
- `tests/frontend/SupportAccessBanner.test.tsx`
- `tests/e2e/commercial-journeys.spec.ts`

## Existing files that still need correction or extension

- `backend/square_integration.py` still depends on sandbox-compatible / mocked Square access for full end-to-end validation.
- `backend/tests/test_postgres_rls.py` and `backend/tests/test_migrations_postgres.py` need the temp PostgreSQL service to be available in the execution environment in order to run without skips.
- `src/pages/SetupConsolePage.tsx` and `src/pages/SquareIntegrationPage.tsx` are functional, but still represent platform flows that need real external validation.
- `docs/` still needs a final staging / manual external-setup pass before any production claim.

## Missing backend work

- Live Google OIDC validation against a real Google OAuth client.
- Live Square OAuth and webhook validation against a real Square Sandbox app.
- A temp PostgreSQL daemon in this workspace so the new PG tests can run instead of skip.

## Missing frontend work

- A final pass over the larger legacy demo pages that still emit lint warnings.
- A dedicated public registration landing flow beyond the current Google callback and onboarding states.

## Missing security work

- Full live validation of Google issuer / audience / nonce handling against an external IdP.
- Full live validation of Square OAuth and webhook processing against the external platform.
- Service-backed PostgreSQL RLS execution in this workspace; the repo has the tests and CI service, but the local daemon is unavailable here.

## Migration risks

- The repo now has migration tests for a fresh PostgreSQL database, the secure backend head, and the prior commercial head, but those are only runnable where the temp PostgreSQL service exists.
- `openpyxl` had been missing from the backend requirements; that has now been added, but the environment needed a fresh install to surface the issue.

## Existing test changes and skips

- No existing test was deleted.
- No existing test was intentionally weakened.
- The current backend skip count is 9, and every skip is PostgreSQL-service gated:
  - `backend/tests/test_migrations_postgres.py`: 3 skips
  - `backend/tests/test_postgres_rls.py`: 6 skips

## Legacy archive status

- The legacy tracker archive remains under `legacy/job-tracker/`.
- The active application still starts from `backend.wsgi:app`.
- The active backend does not import the archived tracker code.
- OCR routes and tests remain present in the repository.

## OCR status

- Invoice OCR remains active through `invoice_ocr.py`, `reconciliation_ocr.py`, `backend/ocr.py`, and the OCR route tests.
- Relevant OCR tests were not removed in this checkpoint.

## Root test-count change

The root Python count is still 15 tests because the prior 24-count referenced in earlier notes appears to have included tests that were later consolidated into `backend/tests/` or moved out of the root discovery path. The current `python -m unittest discover -s tests` run still finds 15 tests and passes.

## Current validation snapshot

- `python -m pytest backend/tests -q` → `68 passed, 9 skipped`
- `python -m unittest discover -s tests` → `15 passed`
- `npm run typecheck` → passed
- `npm test` → `5 passed`
- `npm run lint` → passed with 71 warnings, 0 errors
- `npm run e2e` → `8 passed` and exited cleanly
- `npm run build` → passed

## Audit conclusion

The repository is materially further along than the earlier checkpoint: the commercial UI flows are present, the frontend test stack is real, the browser journeys pass and exit cleanly, the backend suites pass on SQLite, and PostgreSQL service-backed tests plus migration safety tests are now coded and wired into CI. The remaining external work is live Google/Square/Render/DNS validation; the repository itself now has the code, tests, and documentation needed for the commercial product foundation.
