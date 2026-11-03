# Flowtally MVP Release Plan

Owner-approved changes only; see `AGENTS.md` for safety rules. Live status and the next task are in `docs/RELEASE_STATUS.md`. This plan contains no dates or effort estimates by design.

Priority key: **P0** release-blocking, **P1** important (do before or shortly after launch), **P2** post-launch.

Evidence baseline (2026-11-03): `main` = `ccaac01` (PR #160 merged). CI run 41477196327 on `main` and the Pages deploy run 41477196974 both succeeded. Sources: `docs/pilot-end-to-end-readiness.md` (2026-10-26, CONDITIONAL GO), `docs/release-candidate-recording-audit.md` (2026-10-07 Production Showcase), `docs/private-pilot-gap-checklist.md`, `docs/clover-*.md`. Those documents may be stale; re-verify before relying on them for a launch claim.

## Square-first launch decision

**Recommendation: a Square-first MVP can launch while Clover remains in development.**

- Square is the only POS adapter with a CI-executed PostgreSQL vertical workflow (receive purchase, weighted-average cost, mapped sale consumption, replay idempotency, unmapped-sale warning) and a Production Showcase walkthrough (Oct 2026).
- Clover today is Sandbox-only: OAuth, catalog read, mapping and read-only shadow orders are merged; sales-to-inventory reconciliation is open in PR #161 behind `CLOVER_ORDER_INVENTORY_ENABLED=false`. Daily Close, reporting, menu costing and costing have no Clover code paths.
- Therefore Clover must not be advertised as supported. Marketing says "Square today; Clover in development".
- Clover becomes P0 only if the owner's first pilot customers use Clover. That is an **owner decision** (see RELEASE_STATUS owner actions).
- Restaurants without Square can still use purchasing, inventory, costing and manual Daily Close; claims must say so.

## Milestone 1 - Reconcile repository, PRs and deployed state (P0)

- **Business outcome:** one trusted baseline everyone (owner, Claude, Codex) agrees on.
- **Required:** record `main` SHA and CI; triage open PRs (only #161 at audit time); confirm what Production/Staging/Showcase/Demo currently run; confirm Alembic head on each; confirm deploy trigger for the Render services (not visible from the repo).
- **Optional (P2):** archive stale docs/audit files that contradict current state.
- **Dependencies:** owner access to Render/GitHub/hosting consoles.
- **Acceptance:** `RELEASE_STATUS.md` lists every environment with SHA, migration head and last verified date; no unexplained open PRs or unmerged branches.
- **Verification:** `git`/GitHub API for SHAs and CI; `/api/health` on each environment; owner confirms console state.
- **Definition of Done:** status file has no "unknown" environment rows.
- **Human approval:** owner must provide/confirm deployed state. Agents cannot read Render/Aiven.
- **Blocks MVP launch:** Yes.

## Milestone 2 - Purchasing and inventory workflows (P0 core, P1 polish)

- **Business outcome:** an owner can reliably record supplier purchases, receive stock, count, adjust and see correct on-hand and cost.
- **Required (P0):** receive-invoice path with duplicate protection, weighted-average cost and ledger-to-on-hand reconciliation (exists; re-verify on current `main`); stock counts; manual adjustments; OCR failure falls back to manual entry. Owner decision: whether invoice void/correction after receipt is needed for first pilot (unchecked in gap checklist; if wrong receipts cannot be corrected, treat as P0).
- **Optional (P1):** supplier archive policy, line-level mapping review UX, supplier-item mapping UI, bulk import/edit, adjustment reversal. **P2:** inter-location transfer.
- **Dependencies:** M1.
- **Acceptance:** acceptance tests cover receive, replay, count variance and correction on the enabled path; inventory totals equal movement ledger on seeded and Showcase data.
- **Verification:** backend suite incl. PostgreSQL RLS vertical workflow test; Showcase walkthrough.
- **Definition of Done:** CI green; walkthrough recorded in RELEASE_STATUS with run/SHA.
- **Human approval:** owner sign-off on whether void/correction is in or out of MVP scope.
- **Blocks MVP launch:** Yes (P0 items only).

## Milestone 3 - POS integrations, Daily Close and food cost (P0 Square, P1 Clover)

- **Business outcome:** sales from the owner's POS reduce inventory and feed Daily Close accurately.
- **Required (P0, Square):** confirm Square OAuth, location/catalog mapping, order sync, webhook, replay idempotency and Daily Close on current `main`; confirm unmapped/recipe-less sales warn instead of silently deducting.
- **Optional (P1, Clover):** review and merge PR #161 (disabled by default), Showcase rehearsal of the flag-on path with a real paid Sandbox order, then Clover support in Daily Close and food-cost reporting (not implemented). **P2:** historical food-cost reconstruction from Clover cost snapshots; QuickBooks export.
- **Dependencies:** M1; Clover items depend on PR #161 review.
- **Acceptance:** Square: existing vertical test passes unchanged. Clover: flag-off is a verified no-op; flag-on tested through the real endpoint with idempotency, refund/void, concurrency and RLS; Square code paths untouched (diff review).
- **Verification:** CI backend job; Showcase manual check; independent review of PR #161 (financial/inventory change).
- **Definition of Done:** Square verified on Showcase; Clover status recorded honestly (merged-disabled, Sandbox-verified, or not started).
- **Human approval:** owner decides Clover scope for MVP; owner/merchant must supply a Clover Sandbox paid order (external prerequisite). Never enable the flag in Production without owner approval.
- **Blocks MVP launch:** Square part Yes. Clover part No (unless owner declares Clover customer first).

## Milestone 4 - Targeted UI/UX improvements (P1)

- **Business outcome:** non-technical owners can complete core workflows on desktop and phone without help.
- **Required (P0 only if found broken):** mobile layout usable at 390px; every server mutation shows progress/success/failure and refreshes dependent state (AGENTS.md rule).
- **Optional (P1):** copy clarity, empty states, Daily Close and Menu Costing readability. **P2:** visual redesign.
- **Dependencies:** M2, M3 flows stable (avoid rework).
- **Acceptance:** scoped list of defects from a walkthrough, each fixed with a UI/e2e test where behavioral.
- **Verification:** `npm run build`, `npm test`, `npm run e2e`, manual route check incl. mobile (`MOBILE_QA.md`).
- **Definition of Done:** listed defects closed; no new horizontal overflow.
- **Human approval:** owner reviews walkthrough findings.
- **Blocks MVP launch:** Only defects that stop task completion.

## Milestone 5 - Regression, security, tenant isolation, migration and end-to-end validation (P0)

- **Business outcome:** confidence that one customer cannot see another's data and upgrades are safe.
- **Required:** full backend suite; PostgreSQL RLS and tenant-isolation tests; fresh-DB and upgrade migration checks; role-separation checks; secret scan; frontend lint/typecheck/unit/e2e/build; dependency vulnerability review.
- **Optional (P1):** independent security review; load check using `docs/operational-performance.md` method. **P2:** penetration test.
- **Dependencies:** M2, M3 complete for the launch scope.
- **Acceptance:** all CI jobs green on the release candidate SHA; no open P0 defects; migration upgrade tested from the current Production head.
- **Verification:** CI run on the RC commit; `scripts/production_preflight.py` output reviewed by owner; Showcase smoke test.
- **Definition of Done:** evidence (run ID, SHA) recorded in RELEASE_STATUS.
- **Human approval:** owner or independent reviewer signs off on security/RLS evidence.
- **Blocks MVP launch:** Yes.

## Milestone 6 - Release candidate and feature freeze (P0)

- **Business outcome:** a stable, reproducible build that customers can be onboarded onto.
- **Required:** RC branch/tag proposal; freeze checklist below passed; deployment and rollback procedures rehearsed against Staging; reproducible Showcase demo script.
- **Dependencies:** M1-M5.
- **Acceptance:** checklist items all evidenced; open defects are P1/P2 only.
- **Verification:** Staging deploy and rollback rehearsal; Showcase run-through from a clean state.
- **Definition of Done:** owner has explicitly approved freeze and production release.
- **Human approval:** owner approves freeze, tag, production deploy. Agents never do these.
- **Blocks MVP launch:** Yes.

## Milestone 7 - Demo, onboarding, website, pricing and acquisition (P0 minimum, rest P1)

- **Business outcome:** the owner can show, onboard and sell to the first independent restaurants.
- **Required (P0):** accurate claims ("Square today", no fake customers/metrics, per `docs/pre-soft-sell-checklist.md`); demo script (`docs/official-sales-demo.md`, `docs/showcase-runbook.md`); pilot onboarding and support procedure (`docs/pilot-onboarding.md`); working lead form (`VITE_FORM_ENDPOINT`); pricing decision.
- **Optional (P1):** analytics, outreach templates, case-study material once real pilot data exists. **P2:** paid acquisition.
- **Dependencies:** can start in parallel with M4-M5 (docs/marketing only); final claims depend on M6.
- **Acceptance:** every public claim maps to a verified feature in RELEASE_STATUS.
- **Verification:** claims review against status table; form submission test; demo rehearsal.
- **Definition of Done:** owner can run a demo and onboard one pilot using documents only.
- **Human approval:** owner decides pricing, legal/privacy copy, outreach.
- **Blocks MVP launch:** Pricing, honest claims, onboarding/support docs: Yes. Other marketing: No.

## MVP freeze checklist

A freeze means no new features or schema changes without owner approval; bug fixes continue.

- [ ] Core workflows (purchase to receive, count/adjust, Square sale to inventory, Daily Close, menu costing) demonstrated on Showcase.
- [ ] No unresolved P0 defects.
- [ ] Inventory and financial figures reconcile (ledger vs on-hand, cost, Daily Close totals).
- [ ] Regression, RLS/tenant-isolation, migration and security checks pass on the RC SHA.
- [ ] Deployment and rollback rehearsed on Staging; Production migration path from current head tested.
- [ ] Showcase demo reproducible from documented steps.
- [ ] Pilot onboarding and support procedure documented.
- [ ] No misleading product claims (Clover, QuickBooks, supplier ordering, testimonials).
- [ ] Owner explicitly approved freeze and production release.

Post-freeze, allowed without a new freeze decision: security fixes, data-correctness bugs, regressions, copy corrections.

## Dependency order

M1 -> M2 and M3 (parallel, disjoint files) -> M4 -> M5 -> M6; M7 documents/claims run alongside and finalize after M6.
