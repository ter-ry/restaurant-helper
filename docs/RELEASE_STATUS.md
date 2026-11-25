# Flowtally — Full MVP Release Status

Last reconciled 2026-11-16 against live GitHub (main `a46bb23`, issue #315) for the owner-approved **full agreed MVP feature-freeze**, including **Square and Clover**. Binding scope and final checklist: [RELEASE_PLAN.md](RELEASE_PLAN.md) (unchanged by this update). Do not mistake a green CI build or early Square-only pilot for a completed full freeze. The owner-controlled release-control issue is [#211](https://github.com/ter-ry/restaurant-helper/issues/211); it is not edited from here.

**Status vocabulary:** Missing / In progress / Implemented but unverified / Automated tests passed / Sandbox or Showcase verified / Complete and verified / Explicit owner-approved deferral / Blocked.

**How to read this file.** "Merged" means the PR is on main at the cited merge commit. "Automated tests passed" means CI and/or recorded local runs only. **Nothing below is Showcase-verified or Production-verified.** The Showcase walkthrough (#169) and the deployed-environment record (#165) have no evidence recorded yet. This file is a snapshot; live GitHub state wins.

## NEXT TASK — work from GitHub queue

Follow the **Session Start Routine** in `AGENTS.md` against live issues and PRs. No direct push to main, merge, deploy, flag-on Clover, live data or Sandbox transaction without owner approval.

**2026-11-25 (CLAUDE-W1).** The remaining full-MVP gates are owner-controlled, not code: Showcase acceptance #169 (partial owner PASSes recorded 2026-11-24 for the purchase-editor shell, the OCR two-column preview and in-memory mismatch detection; save/reopen/receive/reversal still not exercised live), Clover paid-Sandbox acceptance #166, deployed SHA/Alembic/flag per environment #165, release-candidate sign-off #175, and pricing/terms #174. W1 Milestones B, C and D are merged. Release-candidate test evidence at the current head is in the section below.

Older snapshot at 2026-11-16 (live GitHub wins):

- **Open PRs:** #296 (trusted-review dry-run docs note), #282 (first-pilot commercial policy and onboarding checklists, #281, review-ready), #272 (develop CI smoke test, #268). None touches product code.
- **Merged since the 2026-11-05 snapshot (all with CI at merge; "merged" is not Showcase evidence):** #238 768px fixes, #239 import verification, #241 Clover Daily Close integration, #242 supplier soft archive, #243 negative-stock tests, #246 import ledger guard, #247 Clover signed-ledger usage, #250 POS-negative visibility, #251 inventory row locks, #254 adjustment reversal, #255 bulk edit, #256 OCR draft correction tests, #261 invoice-number 409, #264 Clover cash/DST evidence, #265 invoice void/correction, #267 Clover owner reports, #277 transfers, #303 partial receipts into POS-negative stock, #304/#308/#313/#314 verified-free inventory evidence, #293 schedule demo e2e, and the develop-lane/trusted-review automation (#269, #274, #283, #285, #287, #288, #294-#301, #307).
- **All six owner decisions of 2026-11-05 (#168, #195, #196, #197, #198, #199) now have merged implementations** (see the checklist). Implemented and tested is not Showcase-verified.
- **Open issues by gate:** #316 (W2) verified-free UI browser acceptance, ready; #315 (this reconciliation); #270/#305/#280/#275 trusted-review automation (CI-infra, owner-gated app/credentials); review-ready or blocked leftovers #232, #213, #167 (labels may be stale; verify before relying on them).
- **Owner actions still open:** #174 pricing, terms, support; #165 deployed SHA/Alembic/flag per environment (no evidence); #166 controlled Clover Sandbox validation; #169 Showcase walkthrough on current main; #175 release-candidate validation (blocked); #164 Clover review; #278 decision inbox. Payroll remains the only owner-deferred item.

**Progression rule:** after every PR/review or newly created issue, re-query GitHub and continue with another eligible independent task. Stop only at genuine human/permission/session/usage blockers. Never duplicate another agent's work.

## GitHub baseline

| Item | Verified state / limitation |
|---|---|
| Main | `398f24a` (#398 merged 2026-11-25T01:34Z) |
| CI on main | **Green at that exact head**: run [45526705259](https://github.com/ter-ry/restaurant-helper/actions/runs/45526705259), `backend` success and `frontend` success. The Pages deploy run 45526705348 also succeeded |
| GitHub Pages | Static site only, **not** evidence of any Render backend deployment; latest deploy run not re-verified here |
| Protected main | Active `Protect Main` ruleset verified read-only (#171, closed 2026-11-05); details below |
| Open PRs | #394 (Codex, manual integration verifier), #296, #282, #272 — verified 2026-11-25 |
| Latest Alembic in code | `0030_purchase_invoice_ocr_evidence` (single head, chained onto 0029); **deployed database head unknown**, see Deployments |
| Clover execution | Inventory writes disabled by default and stay off. Reversal/refund handling (#186, `8f4b77f`) and Daily Close source-type exclusion (#184, `48ee7a2`) are merged. No flag-on evidence exists; controlled Sandbox validation #166 is blocked and owner-gated |
| Process PRs | #200, #212, #220, #221 merged (coordination and reporting rules); #235 merged (onboarding/support runbook, #226). #217 was merged then reverted by #218 as unsafe environment automation |

## Release-candidate test evidence (#175) — first-hand, 2026-11-25 on `398f24a`

Earlier W1 sessions could only report "PostgreSQL suites not run here (no DB)", so #175 had no recorded regression evidence. This run executed the gated suites on a disposable local PostgreSQL 16 cluster provisioned exactly like CI, with `flowtally_migrator` and `flowtally_runtime` both `NOSUPERUSER NOBYPASSRLS` so RLS is genuinely enforced. The recipe is in [AUTOMATION_READINESS.md](AUTOMATION_READINESS.md). **This is CI-equivalent automated evidence, not Showcase, Sandbox or Production acceptance.**

| Suite | Result |
|---|---|
| `test_purchasing_inventory_lifecycle_postgres.py` (Milestone B journey) | 2 passed |
| `test_migrations_postgres.py` | 11 passed |
| `test_seed.py::test_migrations_upgrade_and_seed_on_fresh_database` | 1 passed |
| `test_staging_postgres_roles.py` | 1 passed |
| `test_postgres_rls.py` (whole file) | 46 passed, 12 skipped, 0 failed — the skips are the recorded support-access deferral |
| `npm run build` | passed |
| CI at this head | run [45526705259](https://github.com/ter-ry/restaurant-helper/actions/runs/45526705259): `backend` and `frontend` both success |

What this does **not** establish: any deployed environment's SHA, Alembic head or Clover flag (#165), Showcase acceptance of the save/reopen/receive/reversal journey (#169), or Clover paid-Sandbox acceptance (#166). #175 still needs those owner steps.

## Full-MVP feature matrix — evidence status

A required row cannot be marked Complete without integration and acceptance evidence. "Review" below means an independent review comment at the cited head SHA.

| Area | Status | Evidence and remaining action |
|---|---|---|
| Suppliers and purchasing | Automated tests passed; Showcase not verified | Supplier-item mapping #204, per-line suggestions #205, soft archive #242, bulk edit/import #239/#246/#255, invoice void/correction #265, OCR draft correction tests #256, duplicate-number 409 #261, all merged. #142/#143 closed on owner decision (not Showcase evidence). Manual check stays under #169 |
| Inventory ledger/counts/waste/PAR | Automated tests passed; Showcase not verified | Reconciliation suite #201; adjustment reversal #254; transfers #277; row locking #251; negative-stock policy #243/#250/#303; verified-free evidence #304/#308/#313/#314. Open: browser acceptance #316 (W2) |
| Square | Automated tests; October Showcase evidence predates current main | #169 repeat on current main including Daily Close and menu costing |
| Clover catalog/mapping/shadow orders | Sandbox evidence in earlier docs | Do not claim production capability; complete all agreed full-MVP flows |
| Clover inventory | Implemented, disabled | #182/#183 merged (above); #164 review recorded; #166 paid Sandbox test blocked, owner-gated. Verify reversals and idempotency there |
| Clover Daily Close + food cost | Automated tests passed; not externally verified | Merged: #214, #215, #216, #219, #240/#247, #241 provider integration into Daily Close, #264 cash/DST evidence, #267 Clover Owner Reports. Parent #213 label still blocked on #166 (owner-gated Sandbox). No flag-on evidence |
| Daily Close and variance (Square) | Automated tests passed; independent review gap | #209 (`f96f897`, head `4dd6d77`, CI green on head and on main): owner cash policy (staff count primary, verified expected cash only when every drawer shift is closed, Square drawer count kept as evidence, variance unavailable otherwise), exact-value acceptance suite, frozen CSV export, PostgreSQL/RLS test. **No independent verdict is recorded at `4dd6d77`**: the last reviewer comments cover `669a047` and the reverted `0f0a224`. Review is tracked in #228. Showcase under #169 |
| Menu costing | Automated tests passed (Square); Clover costing merged via #216 | Exact-value acceptance tests: #202 (`0251f38`; review APPROVE @ `f95cf75`). Showcase not verified |
| Scheduling demo | Automated tests passed; not manually verified | Derived availability/conflict preview: #203 (`33d4c70`; review APPROVE @ `35e0243` after the overnight-window dispute). Payroll explicitly deferred |
| UI/UX | Partial | #187, #188, #238 (768px), #313 merged. Provider-connected states and real devices not covered; #170 and #169 remain owner/Showcase steps |
| RLS and security | Test suite strengthened | #179 (`67af60c`) and #180 (`6735678`) merged. Final RC validation #175 is blocked; no RC evidence yet |
| Deployments | **Unknown** | See the table below |
| Marketing onboarding | In progress | Claims audit #181 (`f64db55`) merged; #226 onboarding/support runbook merged as a draft built from verified features (#235, `9d2099c`); #174 pricing, terms and support decisions still pending |

## Deployments (#165): unknown until the owner records console evidence

#165 has no evidence comment. Nothing here is inferred from GitHub Pages or from CI.

| Environment | Deployed SHA | Alembic head (0025/0026 applied?) | `CLOVER_ORDER_INVENTORY_ENABLED` | Health |
|---|---|---|---|---|
| Production | unknown | unknown | unknown | unknown |
| Staging | unknown | unknown | unknown | unknown |
| Showcase | unknown | unknown | unknown | unknown |
| Demo | unknown | unknown | unknown | unknown |

## Protected main (#171): verified read-only, closed 2026-11-05

The earlier mismatch (issue text said "no rulesets") is resolved. A read-only API check of ruleset `Protect Main` (id 26415188) was recorded on #171 on 2026-11-05 and the issue was closed: `enforcement: active`, target the default branch `main`, `bypass_actors: []`, rules `pull_request` (0 approvals, review-thread resolution required), `required_status_checks` (`frontend`, `backend`), `non_fast_forward` and `deletion`. No direct-push or destructive test was attempted, so rejection of a direct push is inferred from the configuration, not demonstrated. This does not approve any merge or deploy.

## Owner decisions and scope

- **Approved 2026-11-05** (OWNER DECISION comments on #168, #195, #196, #197, #198, #199; the decision-only issues are closed): all six items are in the MVP with the policies listed under NEXT TASK. Approving a policy is **not** implementation, Showcase or Production verification; the matching rows in `docs/private-pilot-gap-checklist.md` stay unchecked until the implementation merges. Implementation issues: #229, #230, #231, #232, #233, #234, #237.
- **Still needed from the owner:** final pricing, terms, privacy and support channel (#174); controlled Clover Sandbox order and enablement (#166); deployed SHA, Alembic head and Clover flag per environment (#165); Showcase walkthrough (#169); final release approvals.
- **Explicitly owner-deferred for this freeze:** payroll. No other deferral is confirmed; older P2 labels do not count (#176 is a tracking bucket, not a deferral).

## Safety and freeze blockers

- No owner-approved full-MVP freeze while any in-scope feature is missing, unverified or misrepresented; no silent Square-first freeze.
- No Clover inventory flag-on in Production; do not enable anywhere without separate owner approval and completion of the blockers.
- Financial, POS, database, security and inventory PRs need independent review and CI evidence at the exact head SHA; green CI is not approval. PR merges and deployments remain owner-only.
- For a final freeze: complete the matrix, all applicable pilot-checklist items, Square and Clover end-to-end tests, full regression/RLS/migrations, Staging rollback rehearsal and reproducible Showcase acceptance, then explicit owner sign-off.

## Coordination and evidence

Agents claim one GitHub issue per branch/PR, recheck open PRs and claims before each new task, and avoid overlapping files. Read `AGENTS.md` for owner gates and the completion report format. Add new defects as scoped GitHub issues with acceptance criteria. Several closed issues still carry stale `status:*` labels (for example #190-#194 and #208 `status:in-progress`; #163, #178, #182, #183, #206, #207 and #226 `status:review-ready`); labels are not edited from this docs-only update.
