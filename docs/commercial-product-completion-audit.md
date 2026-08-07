# Flowtally commercial product completion audit

Date: 2026-08-07
Branch: `codex/complete-commercial-product-foundation`
Starting commit for this checkpoint: `108d30bb0a9bbda99bdd1d7afad8bfad0d0f442d`

## Requirement matrix

| Area | Status | Notes |
| --- | --- | --- |
| Legacy archive and OCR preservation | Complete | `legacy/job-tracker/` exists and the active app does not import it. OCR test coverage is present in `backend/tests/test_ocr.py` and root tests still pass. |
| Google login and registration | Partial | Google OIDC foundations, callback handling, and session wiring exist, but the full prospect onboarding UI/edge-case handling still needs end-to-end confirmation. |
| Commercial access gating | Partial | Server-side operational gating exists in `backend/access.py` and `backend/policy.py`, but the lifecycle/activation path still needs stronger checks and tighter Square/import dependencies. |
| Owner invitations and memberships | Partial | Invitations, acceptance, cancellation, and membership removal exist, but the workflow still needs full validation against the final commercial lifecycle rules. |
| Module registry and configuration | Partial | Module registry and setup configuration APIs exist, but the UI and activation dependencies still need more explicit enforcement and refinement. |
| Internal setup console | Partial | `backend/platform_admin.py` and `src/pages/SetupConsolePage.tsx` provide a real console, including templates, modules, locations, imports, Square status, customer review, activation, and support grants. Some activation checks still need tightening. |
| Customer onboarding portal | Partial | Onboarding flows exist in backend and frontend, but the setup journey still needs broader confirmation and a more explicit prospect-to-active flow. |
| CSV/XLSX data migration | Partial | Import pipeline, preview, approval, rollback, and UI exist in `backend/imports.py` / `src/pages/DataMigrationPage.tsx`. This still needs more end-to-end validation and integration with activation criteria. |
| PostgreSQL RLS | Partial | Request-scoped tenant context and a broad RLS migration are present, but new tables added later still need to be incorporated into the RLS surface. |
| Support access | Partial | Support grants and banner UI exist, but the full customer operational access model still needs validation against the final lifecycle gate. |
| Owner audit activity | Partial | Audit events are recorded and surfaced in the setup console / owner audit UI, but the full filtered history and retention story still needs review. |
| Square Sandbox integration | Scaffolding only | Square connection models, encryption helpers, and webhook signature helpers exist, but the current integration file is incomplete and needs a full backend/frontend implementation. |
| Frontend product completion | Partial | The console, onboarding, migration, and audit surfaces are present, but the Square workspace and some prospect/activation flows remain incomplete. |
| Migrations and data safety | Partial | Sequential migrations exist through the commercial/import/RLS foundation, but later phases still need bounded follow-up migrations for any new tables. |
| Testing and CI | Partial | Backend and root tests pass, but PostgreSQL-specific and browser-level coverage are still incomplete. |

## Existing files that can be preserved

- `backend/commercial.py`
- `backend/access.py`
- `backend/policy.py`
- `backend/imports.py`
- `backend/platform_admin.py`
- `backend/models.py`
- `backend/tests/test_commercial.py`
- `backend/tests/test_setup_console.py`
- `backend/tests/test_imports.py`
- `backend/tests/test_postgres_rls.py`
- `src/pages/SetupConsolePage.tsx`
- `src/pages/DataMigrationPage.tsx`
- `src/pages/GoogleAuthCompletePage.tsx`
- `src/pages/OwnerAuditPage.tsx`

## Existing files that still need correction or extension

- `backend/square_integration.py` — current draft is incomplete and contains placeholder / consistency issues.
- `backend/app.py` — needs Square blueprint registration.
- `backend/platform_admin.py` — activation checks and setup-state derivation still need to be tightened against the final lifecycle model.
- `src/pages/SetupConsolePage.tsx` — functional, but still needs more explicit state-driven guidance and better Square/import readiness feedback.

## Missing backend work

- Complete Square OAuth, connection, location mapping, catalog sync, order sync, and webhook processing.
- Tighten lifecycle activation criteria so imports, customer review, Square mapping, and setup/payment states are enforced consistently.
- Add any follow-up migrations needed for Square sales persistence and later RLS coverage.

## Missing frontend work

- A dedicated Square Sandbox workspace for owners/support staff.
- Clearer lifecycle/status feedback for the commercial activation path.
- More explicit progress UX for Square, imports, and setup readiness.

## Missing security work

- RLS coverage for any new tables introduced after the current RLS migration.
- More complete tenant-safe support access validation for operational views.
- More exhaustive PostgreSQL tests for raw SQL / cross-tenant leakage across all sensitive tables.

## Missing tests

- Square OAuth state and callback tests.
- Square token encryption / no-plaintext-storage tests for the integration flow.
- Square location mapping, catalog sync, orders sync, and webhook idempotency tests.
- Browser-level checks for the new Square workspace and lifecycle-driven activation flow.

## Migration risks

- The current Square foundation predates a full sales/order persistence model.
- If new Square order tables are added, they must be introduced with a bounded follow-up migration and later RLS coverage.

## Legacy archive status

- The legacy tracker archive exists under `legacy/job-tracker/`.
- The active application entrypoint is `backend.wsgi:app`.
- The archived job tracker is not the active deployment target.
- OCR remains active in the Flowtally backend.

## Root test-count change

The root `tests/` suite currently contains 15 tests. The earlier 24-count referenced in prior notes appears to have included tests that were later consolidated into backend coverage or moved under `backend/tests/`.

