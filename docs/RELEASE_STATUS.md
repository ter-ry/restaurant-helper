# Flowtally — Full MVP Release Status

Last reconciled 2026-11-05 against live GitHub (main `c6cee28`, issue #225) for the owner-approved **full agreed MVP feature-freeze**, including **Square and Clover**. Binding scope and final checklist: [RELEASE_PLAN.md](RELEASE_PLAN.md) (unchanged by this update). Do not mistake a green CI build or early Square-only pilot for a completed full freeze. The owner-controlled release-control issue is [#211](https://github.com/ter-ry/restaurant-helper/issues/211); it is not edited from here.

**Status vocabulary:** Missing / In progress / Implemented but unverified / Automated tests passed / Sandbox or Showcase verified / Complete and verified / Explicit owner-approved deferral / Blocked.

**How to read this file.** "Merged" means the PR is on main at the cited merge commit. "Automated tests passed" means CI and/or recorded local runs only. **Nothing below is Showcase-verified or Production-verified.** The Showcase walkthrough (#169) and the deployed-environment record (#165) have no evidence recorded yet. This file is a snapshot; live GitHub state wins.

## NEXT TASK — work from GitHub queue

Follow the **Session Start Routine** in `AGENTS.md` against live issues and PRs. No direct push to main, merge, deploy, flag-on Clover, live data or Sandbox transaction without owner approval. Snapshot at 2026-11-05:

- **Open PR:** [#219](https://github.com/ter-ry/restaurant-helper/pull/219) Clover usage PG/RLS tests and malformed-recipe fix (#213). Head `260be7b`, CI passed; Codex `REQUEST CHANGES @ 75db692` was addressed in that head and independent re-review is pending. The owner authorised takeover of that branch on the PR; do not touch it otherwise.
- **Claimed, in progress (do not duplicate):** #222 Clover Daily Close provider integration (slice 4 of #213; owns Clover edits to `backend/daily_close.py`), #223 768px UI audit, #224 CSV/XLSX import verification, #225 this document, #226 onboarding runbook.
- **Ready for an independent reviewer (not the author):** [#228](https://github.com/ter-ry/restaurant-helper/issues/228) post-merge review of the Daily Close cash policy and frozen CSV export (#209).
- **Owner decisions pending:** #168 invoice void/correction; #195 supplier archive; #196 adjustment reversal; #197 inter-location transfers; #198 bulk import/edit; #199 negative on-hand stock; #174 pricing, terms, support.
- **Owner/external gates:** #165 deployed SHA/Alembic/flag per environment; #166 controlled Clover Sandbox validation (blocked); #169 Showcase walkthrough; #171 ruleset verification; #172 Playwright in the cloud environment; #175 release-candidate validation (blocked); #164 Clover review (recorded, kept open for the owner); #170 UI walkthrough (open, needs-owner).
- Closed 2026-11-05 on recorded owner decisions dated 2026-11-04: #142, #143 (see matrix; not Showcase evidence).

**Progression rule:** after every PR/review or newly created issue, re-query GitHub and continue with another eligible independent task. Stop only at genuine human/permission/session/usage blockers. Never duplicate another agent's work.

## GitHub baseline

| Item | Verified state / limitation |
|---|---|
| Main | `c6cee28` (#221 merged 2026-11-05T14:43Z) |
| CI on main | [run 42047732999](https://github.com/ter-ry/restaurant-helper/actions/runs/42047732999) on `c6cee28`: backend, frontend, build success |
| GitHub Pages | [run 42047732997](https://github.com/ter-ry/restaurant-helper/actions/runs/42047732997) success on `c6cee28`. This is the static site only, **not** evidence of any Render backend deployment |
| Protected main | Active `Protect Main` ruleset observed read-only via the API; discrepancy with #171 listed below |
| Open PRs | #219 only |
| Latest Alembic in code | `0026_clover_consumption_cost_snapshot` (no newer migration on main); **deployed database head unknown**, see Deployments |
| Clover execution | Inventory writes disabled by default and stay off. Reversal/refund handling (#186, `8f4b77f`) and Daily Close source-type exclusion (#184, `48ee7a2`) are merged. No flag-on evidence exists; controlled Sandbox validation #166 is blocked and owner-gated |
| Process PRs | #200, #212, #220, #221 merged (coordination and reporting rules). #217 was merged then reverted by #218 as unsafe environment automation |

## Full-MVP feature matrix — evidence status

A required row cannot be marked Complete without integration and acceptance evidence. "Review" below means an independent review comment at the cited head SHA.

| Area | Status | Evidence and remaining action |
|---|---|---|
| Suppliers and purchasing | Automated tests passed; Showcase not verified | Supplier-item mapping API/UI: #204 (`b26913f`; review APPROVE @ `0ee12dd` after the location-isolation and duplicate-race fixes). Per-line suggestion and issue list: #205 (`0d8ab01`; review APPROVE @ `cb6c83d`). OCR table quantity (#142) and receipt-dialog close (#143): closed 2026-11-05 on an owner decision (dated 2026-11-04) citing PR #144 and regression tests; **that decision is not Showcase evidence**, the manual check stays under #169. Open: #168 invoice void, #195 supplier archive, #198 bulk import/edit (existing import jobs under verification in #224); draft correction after OCR is not claimed |
| Inventory ledger/counts/waste/PAR | Automated tests passed; gaps open | Ledger/on-hand/cost reconciliation tests: #201 (`5788f28`; review APPROVE @ `c6bfa69`). Open decisions: #196 adjustment reversal, #197 transfers, #199 negative stock |
| Square | Automated tests; October Showcase evidence predates current main | #169 repeat on current main including Daily Close and menu costing |
| Clover catalog/mapping/shadow orders | Sandbox evidence in earlier docs | Do not claim production capability; complete all agreed full-MVP flows |
| Clover inventory | Implemented, disabled | #182/#183 merged (above); #164 review recorded; #166 paid Sandbox test blocked, owner-gated. Verify reversals and idempotency there |
| Clover Daily Close + food cost | In progress | Merged: #214 net-sales/cash-tender normalization (`b3f9b14`), #215 one active POS provider per location (`99bb33d`), #216 ledger-based usage and food cost (`9bee2ce`); each had an independent APPROVE at its final head. Open: #219 follow-up PR, #222 provider integration into the shared Daily Close (claimed). Parent #213 is blocked on #222 and on #166. Not externally verified |
| Daily Close and variance (Square) | Automated tests passed; independent review gap | #209 (`f96f897`, head `4dd6d77`, CI green on head and on main): owner cash policy (staff count primary, verified expected cash only when every drawer shift is closed, Square drawer count kept as evidence, variance unavailable otherwise), exact-value acceptance suite, frozen CSV export, PostgreSQL/RLS test. **No independent verdict is recorded at `4dd6d77`**: the last reviewer comments cover `669a047` and the reverted `0f0a224`. Review is tracked in #228. Showcase under #169 |
| Menu costing | Automated tests passed (Square); Clover costing merged via #216 | Exact-value acceptance tests: #202 (`0251f38`; review APPROVE @ `f95cf75`). Showcase not verified |
| Scheduling demo | Automated tests passed; not manually verified | Derived availability/conflict preview: #203 (`33d4c70`; review APPROVE @ `35e0243` after the overnight-window dispute). Payroll explicitly deferred |
| UI/UX | Partial | #187 (`04d6d72`) and #188 (`35f2f51`) merged. #170 evidence covers a seeded-pilot 390px walkthrough only; provider-connected states, 768px (#223 in progress) and real devices are not covered |
| RLS and security | Test suite strengthened | #179 (`67af60c`) and #180 (`6735678`) merged. Final RC validation #175 is blocked; no RC evidence yet |
| Deployments | **Unknown** | See the table below |
| Marketing onboarding | In progress | Claims audit #181 (`f64db55`) merged; #174 owner decisions pending; #226 runbook claimed |

## Deployments (#165): unknown until the owner records console evidence

#165 has no evidence comment. Nothing here is inferred from GitHub Pages or from CI.

| Environment | Deployed SHA | Alembic head (0025/0026 applied?) | `CLOVER_ORDER_INVENTORY_ENABLED` | Health |
|---|---|---|---|---|
| Production | unknown | unknown | unknown | unknown |
| Staging | unknown | unknown | unknown | unknown |
| Showcase | unknown | unknown | unknown | unknown |
| Demo | unknown | unknown | unknown | unknown |

## Protected main (#171): discrepancy for owner verification

Read-only API check on 2026-11-05; no repository setting was changed.

- Live: ruleset `Protect Main` (id 26415188, created 2026-11-03T01:36Z) is `active` on the default branch with no bypass actors. Rules: `deletion`, `non_fast_forward`, `pull_request` (0 required approvals, review-thread resolution required) and `required_status_checks` for `frontend` and `backend` (not strict). The classic branch-protection endpoint returns 404, expected when only a ruleset is used.
- #171 body (created 2026-11-03T01:17Z, never edited, still `status:ready` + `needs-owner`) says main "is currently not protected" with "no rulesets". The ruleset appeared 19 minutes later, so the issue text is stale.
- Not verified by agents: that a direct push to `main` is rejected (the issue's acceptance criterion). The owner should confirm with a throwaway-branch test or a settings screenshot, then update or close #171.

## Open scope decisions (owner approval required)

- **#168** invoice void/correction after receipt (ledger-safe reversal); the plan presumes in scope unless explicitly deferred.
- **#195, #196, #197, #198, #199** supplier archive, adjustment reversal, transfers, bulk import/edit, negative on-hand: each has options and a recommended default in its issue. The matching `docs/private-pilot-gap-checklist.md` rows stay unchecked until an owner decision or explicit deferral per item. Do not silently move them to post-launch.
- Final pricing, terms, privacy and support channel (#174); controlled Clover Sandbox order and enablement (#166); deployment evidence (#165); final release approvals.
- **Explicitly owner-deferred for this freeze:** payroll. No other deferral is confirmed; older P2 labels do not count (#176 is a tracking bucket, not a deferral).

## Safety and freeze blockers

- No owner-approved full-MVP freeze while any in-scope feature is missing, unverified or misrepresented; no silent Square-first freeze.
- No Clover inventory flag-on in Production; do not enable anywhere without separate owner approval and completion of the blockers.
- Financial, POS, database, security and inventory PRs need independent review and CI evidence at the exact head SHA; green CI is not approval. PR merges and deployments remain owner-only.
- For a final freeze: complete the matrix, all applicable pilot-checklist items, Square and Clover end-to-end tests, full regression/RLS/migrations, Staging rollback rehearsal and reproducible Showcase acceptance, then explicit owner sign-off.

## Coordination and evidence

Agents claim one GitHub issue per branch/PR, recheck open PRs and claims before each new task, and avoid overlapping files. Read `AGENTS.md` for owner gates and the completion report format. Add new defects as scoped GitHub issues with acceptance criteria. Closed issues #190-#194 and #208 still carry `status:in-progress`, and #163, #178, #182, #183, #206 and #207 still carry `status:review-ready`; labels are not edited from this docs-only update.
