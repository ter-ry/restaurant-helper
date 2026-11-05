# Flowtally — Full MVP Release Status

Last reconciled 2026-11-05 against live GitHub (main `9d2099c`, issue #225, PR #236) for the owner-approved **full agreed MVP feature-freeze**, including **Square and Clover**. Binding scope and final checklist: [RELEASE_PLAN.md](RELEASE_PLAN.md) (unchanged by this update). Do not mistake a green CI build or early Square-only pilot for a completed full freeze. The owner-controlled release-control issue is [#211](https://github.com/ter-ry/restaurant-helper/issues/211); it is not edited from here.

**Status vocabulary:** Missing / In progress / Implemented but unverified / Automated tests passed / Sandbox or Showcase verified / Complete and verified / Explicit owner-approved deferral / Blocked.

**How to read this file.** "Merged" means the PR is on main at the cited merge commit. "Automated tests passed" means CI and/or recorded local runs only. **Nothing below is Showcase-verified or Production-verified.** The Showcase walkthrough (#169) and the deployed-environment record (#165) have no evidence recorded yet. This file is a snapshot; live GitHub state wins.

## NEXT TASK — work from GitHub queue

Follow the **Session Start Routine** in `AGENTS.md` against live issues and PRs. No direct push to main, merge, deploy, flag-on Clover, live data or Sandbox transaction without owner approval. Snapshot at 2026-11-05:

- **Open PRs (live, 2026-11-05, as of 17:11Z; heads move quickly, so re-check GitHub; each needs an independent review verdict at its current head before owner merge):**

  | PR | Issue | Head | CI at head | Review state |
  |---|---|---|---|---|
  | [#238](https://github.com/ter-ry/restaurant-helper/pull/238) 768px UI/mutation-state fixes | #223 | `534204e` | frontend passed, backend in progress | `REQUEST CHANGES @ 3b52734` replied to; re-review of `534204e` requested on the PR (only tests changed since `cca3528`) |
  | [#239](https://github.com/ter-ry/restaurant-helper/pull/239) import verification and fixes | #224 | `44bc61a` | passed | `REQUEST CHANGES @ bd20749` addressed in `44bc61a`; re-review pending |
  | [#241](https://github.com/ter-ry/restaurant-helper/pull/241) Clover Daily Close provider integration | #222 | `133bd0d` | frontend passed, backend in progress | `REQUEST CHANGES @ 3294b79` is the latest recorded verdict; none recorded at `133bd0d` |
  | [#242](https://github.com/ter-ry/restaurant-helper/pull/242) supplier soft archive | #229 | `2e154c1` | passed | `REQUEST CHANGES @ 2e154c1` open |
  | [#243](https://github.com/ter-ry/restaurant-helper/pull/243) negative-stock acceptance tests | #230 | `3b8d229` | passed | no review recorded |
  | [#236](https://github.com/ter-ry/restaurant-helper/pull/236) this document | #225 | see PR | see PR | `REQUEST CHANGES @ 33782a5` addressed by this update |

  Documentation overlap: #241 edits one row of this file (Clover Daily Close) and #239 edits one line of `docs/private-pilot-gap-checklist.md` (bulk import). Both are single-line hunks; whichever of #236, #239 and #241 merges second needs a one-line conflict resolution in that row; guidance is in the #236 review-response comment.
- **Owner decisions approved 2026-11-05 (decision issues #168, #195, #196, #197, #198, #199 closed). Policy is settled; every implementation below is still pending, not done:**
  - #168 received-invoice void/correction is in the MVP: append-only compensating movements exactly once, corrected invoice re-received with lineage, unsafe cases rejected. Implementation #232.
  - #195 supplier soft archive only, no hard delete. Implementation #229.
  - #196 append-only, once-only adjustment reversal that cannot drive stock negative. Implementation #231.
  - #197 atomic inter-location transfers preserving source weighted-average cost. Implementation #233.
  - #198 retain and verify CSV/XLSX import and add in-app multi-select bulk edit of inventory items. Verification #224; implementation #234.
  - #199 manual receipts/corrections/adjustments may not go negative; POS consumption may, flagged for review. Baseline tests #230; Daily Close/Reorder visibility #237.
- **Implementation queue state:** #229 review-ready (PR #242); #230 in progress (PR #243); #231, #232, #233, #234 and #237 are **blocked on sequencing, not on a decision**: #231 waits for #229 and #230 to merge; #232 for #231; #233 for #230 and #231; #234 for #224 and #229; #237 for #222 and #230. #240 (signed-ledger quantity in Clover usage) is ready and owner-unblocked since #219 merged. #227 (import re-upload/rollback can change on-hand outside the ledger) is blocked pending #239.
- **Independent reviewer wanted (not the author):** [#228](https://github.com/ter-ry/restaurant-helper/issues/228) post-merge review of the Daily Close cash policy and frozen CSV export (#209).
- **Still open for the owner:** #174 pricing, terms, support; #165 deployed SHA/Alembic/flag per environment (no evidence yet); #166 controlled Clover Sandbox validation (blocked); #169 Showcase walkthrough; #172 Playwright in the cloud environment; #175 release-candidate validation (blocked); #164 Clover review (recorded, kept open for the owner); #170 UI walkthrough (open, needs-owner). Closed with recorded owner decisions: #142 and #143 on 2026-11-05 (not Showcase evidence; see matrix) and #171 (see below).

**Progression rule:** after every PR/review or newly created issue, re-query GitHub and continue with another eligible independent task. Stop only at genuine human/permission/session/usage blockers. Never duplicate another agent's work.

## GitHub baseline

| Item | Verified state / limitation |
|---|---|
| Main | `9d2099c` (#235 merged 2026-11-05T11:46-05:00; #219 merged just before as `d2ae685`) |
| CI on main | [run 42067857772](https://github.com/ter-ry/restaurant-helper/actions/runs/42067857772) on `9d2099c`: backend, frontend, build success |
| GitHub Pages | [run 42067843909](https://github.com/ter-ry/restaurant-helper/actions/runs/42067843909) success on `9d2099c`. This is the static site only, **not** evidence of any Render backend deployment |
| Protected main | Active `Protect Main` ruleset verified read-only (#171, closed 2026-11-05); details below |
| Open PRs | #236, #238, #239, #241, #242, #243 (table in NEXT TASK) |
| Latest Alembic in code | `0026_clover_consumption_cost_snapshot` (no newer migration on main); **deployed database head unknown**, see Deployments |
| Clover execution | Inventory writes disabled by default and stay off. Reversal/refund handling (#186, `8f4b77f`) and Daily Close source-type exclusion (#184, `48ee7a2`) are merged. No flag-on evidence exists; controlled Sandbox validation #166 is blocked and owner-gated |
| Process PRs | #200, #212, #220, #221 merged (coordination and reporting rules); #235 merged (onboarding/support runbook, #226). #217 was merged then reverted by #218 as unsafe environment automation |

## Full-MVP feature matrix — evidence status

A required row cannot be marked Complete without integration and acceptance evidence. "Review" below means an independent review comment at the cited head SHA.

| Area | Status | Evidence and remaining action |
|---|---|---|
| Suppliers and purchasing | Automated tests passed; Showcase not verified | Supplier-item mapping API/UI: #204 (`b26913f`; review APPROVE @ `0ee12dd` after the location-isolation and duplicate-race fixes). Per-line suggestion and issue list: #205 (`0d8ab01`; review APPROVE @ `cb6c83d`). OCR table quantity (#142) and receipt-dialog close (#143): closed 2026-11-05 on an owner decision (dated 2026-11-04) citing PR #144 and regression tests; **that decision is not Showcase evidence**, the manual check stays under #169. Owner policy approved 2026-11-05, **implementation pending**: #168 invoice void/correction (#232, blocked on #231), #195 supplier soft archive (#229; PR #242 open with `REQUEST CHANGES @ 2e154c1`), #198 bulk edit (#234, blocked on #224 and #229) and import verification (#224; PR #239 open). Draft correction after OCR is not claimed |
| Inventory ledger/counts/waste/PAR | Automated tests passed; gaps open | Ledger/on-hand/cost reconciliation tests: #201 (`5788f28`; review APPROVE @ `c6bfa69`). Owner policy approved 2026-11-05, **implementation pending**: #196 adjustment reversal (#231, blocked on #229 and #230), #197 transfers (#233, blocked on #230 and #231), #199 negative stock (baseline tests #230 in PR #243; Daily Close/Reorder visibility #237, blocked on #222 and #230) |
| Square | Automated tests; October Showcase evidence predates current main | #169 repeat on current main including Daily Close and menu costing |
| Clover catalog/mapping/shadow orders | Sandbox evidence in earlier docs | Do not claim production capability; complete all agreed full-MVP flows |
| Clover inventory | Implemented, disabled | #182/#183 merged (above); #164 review recorded; #166 paid Sandbox test blocked, owner-gated. Verify reversals and idempotency there |
| Clover Daily Close + food cost | In progress | Merged: #214 net-sales/cash-tender normalization (`b3f9b14`), #215 one active POS provider per location (`99bb33d`), #216 ledger-based usage and food cost (`9bee2ce`); each had an independent APPROVE at its final head. #219 usage PG/RLS tests and malformed-recipe fix merged (`d2ae685`; independent APPROVE @ `260be7b`). Open: PR #241 (#222) provider integration into the shared Daily Close (CI passed; `REQUEST CHANGES @ 3294b79` open). #240 signed-ledger usage fix is ready; per the #222 handoff, Clover usage/food cost are unavailable on real data until it merges. Parent #213 is blocked on #222 and #166. Not externally verified |
| Daily Close and variance (Square) | Automated tests passed; independent review gap | #209 (`f96f897`, head `4dd6d77`, CI green on head and on main): owner cash policy (staff count primary, verified expected cash only when every drawer shift is closed, Square drawer count kept as evidence, variance unavailable otherwise), exact-value acceptance suite, frozen CSV export, PostgreSQL/RLS test. **No independent verdict is recorded at `4dd6d77`**: the last reviewer comments cover `669a047` and the reverted `0f0a224`. Review is tracked in #228. Showcase under #169 |
| Menu costing | Automated tests passed (Square); Clover costing merged via #216 | Exact-value acceptance tests: #202 (`0251f38`; review APPROVE @ `f95cf75`). Showcase not verified |
| Scheduling demo | Automated tests passed; not manually verified | Derived availability/conflict preview: #203 (`33d4c70`; review APPROVE @ `35e0243` after the overnight-window dispute). Payroll explicitly deferred |
| UI/UX | Partial | #187 (`04d6d72`) and #188 (`35f2f51`) merged. #170 evidence covers a seeded-pilot 390px walkthrough only; provider-connected states, 768px (#223: PR #238 open, CI passed, re-review of `cca3528` pending) and real devices are not covered |
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
