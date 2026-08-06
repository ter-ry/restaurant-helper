# Flowtally Commercial Product Completion Audit

Date: 2026-08-06  
Branch start: `codex/commercial-onboarding-square-foundation`  
Starting commit: `4789ca2f4bafe13ea242be86120e8700ab2a3e52`

This audit records the repository state before completing the commercial product foundation. It is intentionally requirement-by-requirement so implementation can proceed in bounded phases.

## Audit Summary

The repository already contains a strong backend foundation for commercial state, Google OIDC, Square scaffolding, tenant-aware access control, and an archived legacy job tracker. It does not yet contain the full customer-facing or internal commercial product required by the prompt.

The main pattern is:

- backend models and helper logic exist for several commercial concerns
- frontend coverage for the commercial product is mostly absent
- activation, setup, import, support, audit, and Square sync flows are scaffolded or missing
- PostgreSQL tenant protection is not implemented
- the legacy job tracker archive exists, but deployment configuration still needs a final verification pass

## Gap Matrix

| Requirement area | Status | Evidence in repo | Notes |
| --- | --- | --- | --- |
| Legacy archive and OCR preservation | Partial | `legacy/job-tracker/`, `app.py`, `tests/test_invoice_ocr.py`, `tests/test_reconciliation_ocr.py`, `Procfile` | Archive copy exists and OCR remains active in the root app. The root Render config still references `app:app`, so active deployment config needs correction. |
| Google OIDC backend | Partial | `backend/google_oidc.py`, `backend/auth.py`, `backend/tests/test_google_oidc.py` | Authorization-code flow, state, nonce, issuer/audience checks, and verified-email checks exist. Frontend login and account-registration flows are still missing. |
| Public registration / onboarding signup | Missing | No dedicated customer onboarding frontend; `backend/auth.py` only handles login and callback | Google registration exists only as backend identity creation logic. |
| Commercial lifecycle and access gating | Partial | `backend/models.py`, `backend/access.py`, `backend/commercial.py`, `backend/policy.py`, `backend/tests/test_commercial.py`, `backend/tests/test_pilot_api.py` | Commercial status concepts exist, but the full centralized operational policy and all route-level checks are not yet complete for the requested product scope. |
| Invitations and membership management | Missing | `backend/models.py` has invitation-related models, but no complete invite workflow UI/API | Invitation acceptance, revocation, reissue, and owner-only membership management are not finished end to end. |
| Modular setup architecture | Partial | `backend/modules.py`, `backend/commercial.py`, `backend/models.py` | Registry and some module entitlements exist, but setup templates, configuration versions, layouts, and custom fields are not complete. |
| Internal setup console | Missing | No setup-console frontend or platform-only workflow | Only data models and some backend scaffolding exist. |
| Customer onboarding portal | Missing | No onboarding portal frontend | Prospect onboarding exists only as backend/commercial scaffolding. |
| CSV/XLSX data migration pipeline | Missing | No import workflow, mapping UI, preview/approval/rollback stack | No end-to-end import system exists yet. |
| PostgreSQL row-level security | Missing | No RLS migration or runtime tenant context | Application-layer filtering exists, but database-level RLS is not implemented. |
| Support access workflow | Missing | `backend/models.py` has `SupportAccessGrant`, but no complete support console or banner flow | No complete time-limited support-grant flow yet. |
| Owner audit history UI | Missing | `backend/audit.py` and audit event models exist | No owner-only audit interface yet. |
| Square Sandbox OAuth and sync | Partial | `backend/square.py`, `backend/models.py`, `backend/tests/test_square.py` | OAuth / encryption helpers and webhook signature logic exist, but locations, catalog, order sync, and frontend workflows are missing. |
| Frontend commercial product completion | Missing | Current app is still demo/pilot oriented | There is no completed prospect/owner/platform/support UI set for the commercial product. |
| Migrations and data safety | Partial | `backend/migrations/versions/0007_commercial_onboarding_and_square_foundation.py` | One large commercial migration exists; it needs review and likely follow-up migrations rather than more monoliths. |
| Testing and CI | Partial | `backend/tests/*`, `tests/test_invoice_ocr.py`, `tests/test_reconciliation_ocr.py`, `npm run build` | Backend and OCR tests exist, but there are no PostgreSQL RLS tests, browser E2E tests, or a complete CI matrix for the requested scope. |
| Staging readiness | Partial | `backend/.env.staging.example`, `render.pilot-staging.yaml`, `Procfile` | Staging docs and backend entrypoint exist, but full staging readiness documentation and verification are incomplete. |

## Existing files to preserve

- `app.py` and OCR helpers: preserve the invoice and reconciliation OCR paths.
- `tests/test_invoice_ocr.py` and `tests/test_reconciliation_ocr.py`: preserve OCR coverage.
- `backend/google_oidc.py`: preserve the correctly implemented OIDC verification pieces.
- `backend/access.py`, `backend/commercial.py`, `backend/modules.py`, `backend/square.py`: preserve the commercial scaffolding as a base for completion.
- `backend/models.py` and `backend/migrations/versions/0007_commercial_onboarding_and_square_foundation.py`: preserve the commercial schema work, but review for split follow-up migrations.
- `legacy/job-tracker/`: preserve the archived legacy app.

## Existing files that need correction

- `render.yaml`: still starts the legacy root app with `gunicorn app:app`.
- `backend/modules.py` and `backend/commercial.py`: overlapping module-registry abstractions should be reconciled.
- `legacy/job-tracker/MANIFEST.txt` / archive checksum: should be treated as verified only after matching the external ZIP contents.

## Missing backend work

- full registration and login-assisted onboarding flow
- invitation acceptance and revocation
- setup console APIs
- customer onboarding portal APIs
- import pipeline models and endpoints
- PostgreSQL RLS migrations and request-scoped context
- support grant lifecycle APIs
- owner audit listing and filtering APIs
- Square OAuth / location / catalog / order sync APIs

## Missing frontend work

- continue with Google
- onboarding portal
- setup console
- team/invitations UI
- module configuration UI
- custom field editor
- import mapping / preview / approval UI
- support grant console
- audit activity page
- Square connection and sync UI

## Missing security work

- database-level tenant isolation with PostgreSQL RLS
- explicit support-grant context and banner
- full owner-only authorization for internal audit/setup actions
- safer and more explicit account-linking UX

## Missing tests

- browser-level login / onboarding / setup / invite / import / Square tests
- PostgreSQL RLS tests
- migration upgrade/downgrade tests across the commercial schema boundary
- support-grant expiry/revocation tests
- owner audit filtering tests

## Migration risks

- the current commercial migration is large and likely too monolithic for long-term safety
- overlapping commercial/module abstractions increase the chance of follow-up schema churn
- PostgreSQL-only security requirements are not yet represented in migrations

## Test weakening / removal

- OCR root tests were preserved in `tests/test_invoice_ocr.py` and `tests/test_reconciliation_ocr.py`
- the old job-tracker integration tests were removed from the active root tree and archived under `legacy/job-tracker/tests/`
- no evidence yet that the remaining OCR tests were weakened

## Legacy archive status

The archive is present in `legacy/job-tracker/` and includes:

- `app.py`
- OCR helpers
- `README.md`
- `HANDOFF.md`
- `MOBILE_QA.md`
- `Procfile`
- `render.yaml`
- `requirements.txt`
- `templates/`
- `static/`
- `sources/`
- `tests/`

The archive looks structurally complete from repository inspection, but the external ZIP and checksum still need final verification against the archive path referenced in the prompt.

## OCR status

OCR is still active in the root app:

- invoice OCR route: `/api/invoices/ocr`
- reconciliation OCR route: `/api/reconciliation/extract`
- active tests: `tests/test_invoice_ocr.py`, `tests/test_reconciliation_ocr.py`

The root test count changed because the active repository now contains only the OCR-focused root tests; the old job-tracker integration and app tests were removed from the live tree and preserved in the archive instead. That is why the current root test count is lower than the earlier audit count.

## First implementation phase to begin

Phase 1: verify the legacy archive / deployment split and preserve OCR without any regression.

That means:

1. confirm the legacy job tracker is fully inactive in active deployment config
2. confirm OCR routes and tests remain functional
3. correct any remaining entrypoint/config drift
4. then proceed to Google registration and the commercial access flow

