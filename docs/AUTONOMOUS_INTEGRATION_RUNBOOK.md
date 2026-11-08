# Flowtally Autonomous Integration: Staged Activation Runbook

> Status: **NOT ACTIVE**. This document and the `develop` branch are infrastructure preparation, not permission to merge or deploy unattended. The owner approved the *architecture* on 2026-11-08 in [issue #268](https://github.com/ter-ry/restaurant-helper/issues/268); activation requires the evidence and explicit acceptance below.

## Branch and deployment contract

| Destination | Purpose | Automated merge | Deployment |
| --- | --- | --- | --- |
| Feature branches (`claude/*`, `codex/*`) | Agent-owned changes | No | No |
| `develop` | Non-production feature integration | **Off until safe gatekeeper is proven**; then only eligible PRs | No automatic Production or GitHub Pages deploy |
| `main` | Owner-approved release source | **Never** | Push invokes `.github/workflows/deploy.yml` (GitHub Pages); backend deployment settings are external/unverified |

The `develop` branch was initialized from `main` at `ef45f4806273592b30d94477359bc236ced61617`. The default branch stays `main`. `CI` runs on pull requests and pushes for both branches. Do not change `deploy.yml` to deploy from `develop`. Independently verify Render service branch/auto-deploy and database-migration settings before activation; no inference from GitHub Pages alone.

**Transition:** existing PRs #265, #266 and #267 keep their current target bases until their owners complete them or explicitly agree on retargeting. Do not turn scheduled workers toward `develop` while the gatekeeper is disabled or the ruleset is unconfigured. After protection and successful dry runs, update the persistent `AGENTS.md`, `CLAUDE.md` import where appropriate, worker/reviewer schedule instructions, and issue claim rules together. Never silently strand open PRs on `main`. New feature PRs should then target `develop`, not `main`; release PRs should target `main` from `develop` and remain owner-controlled.

## Required GitHub protection settings — OWNER ACTION

Settings → Rules → Rulesets → New branch ruleset for each of `main` and `develop` (public repository; alternatively use branch-protection rules).

- For **both**: require PR; require `backend` and `frontend` checks (confirm their exact unique check names from a successful workflow run); require up-to-date branch or a verified merge queue; require conversation resolution; block force pushes/deletion; avoid administrative or bot bypass of checks; prefer linear history/squash merges. Verify the rules are actually active and reject a deliberately noncompliant test PR.
- For **main**: require at least one formal non-author human/independent authorized GitHub review and keep releases manual. Make the owner the only release decision-maker via process and restricted write access; do not allow the integration gatekeeper to target main. A PR into main remains a release even if it only alters workflows/documentation because Pages deploys on every main push.
- For **develop**: initially require a formal independent, non-author review as well. A shared `ter-ry` GitHub login used by multiple AI sessions is *not* a distinct reviewer identity. Before unattended merges, establish an independently attributable trusted reviewer GitHub identity/App or a rigorously verified signed review-attestation control that branch rules actually enforce. Do not weaken review requirements just to make the gate run.
- Ensure required checks exist on `develop` PRs **before** activating a rule requiring them (the foundation CI workflow must first be merged by the owner). Check that the `CI` workflow is allowed by repository Actions settings.
- Repository settings currently report `allow_auto_merge=false`. Enabling native auto-merge is optional only after protection/testing; a custom GitHub Action can instead attempt protected REST merges. Neither route can bypass required checks.

## Separate trusted merge gatekeeper (future implementation; not PR #266 as-is)

The owner notification PR #266 is currently **review-only and defective**; it is not an auto-merge implementation. Fix its seven findings independently, ensure its tests run in CI, and keep its notification writes disabled until tested. The new merge actuator must be a separate privileged workflow/component with an explicit `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED=false` repository variable by default.

Always re-fetch live GitHub state immediately before a merge. Only consider a non-draft PR with base `develop`, an approved and issue-linked task, no unmet dependencies/owner questions, no overlapping active work, a valid head SHA, full passing required checks against current target, no pending reviewers, no unresolved discussions (including outdated threads), and a verifiable **independent substantive** review at the exact head. Generic Codex no-findings receipts, same-account AI comments, author self-reviews, and stale approvals are *not* qualifying evidence. Every source error, missing check, ambiguous identity, unexpected label/permission, or policy mismatch must **fail closed** with a concise PR comment/report, not auto-merge.

Risk policy:
- **Tier 0** (candidate for automation only after proof): limited documentation, non-sensitive component tests, or low-impact UI changes with no financial/auth/mutation/deployment behavior; still require all gates.
- **Tier 1** (stricter, initially manual): purchasing, inventory, financial or POS behavior; reporting/reconciliation; backend endpoints, migrations, tenant/RLS/security; requires strong independent proof and relevant PostgreSQL/RLS/migration/idempotency/rollback tests. Two verified independent substantive reviews before considering unattended integration. If identity/provenance cannot be proven, keep owner-controlled.
- **Tier 2** (never unattended): any `.github/workflows/`, `AGENTS.md`, agent/gatekeeper/permissions configuration, `render*.yaml`, `Procfile`, secrets/auth credentials, release scripts, live-data/production migration execution, infrastructure configuration, or enablement of `CLOVER_ORDER_INVENTORY_ENABLED`. Also any task marked `needs-owner`, disputed financial policy, or uncertain merchant/real-world behavior. **Do not let an untrusted PR modify the allowlist/classifier or its own gate.**

Trusted workflow security: do not execute or check out untrusted PR head content with a privileged token. Pin/restrict permissions; explicitly validate repository, base, head, authorship, event, labels, check-run source, and review actor. A `pull_request_target` or `workflow_run` trigger is a privilege boundary. Use an immutable, trusted `main` checkout for evaluation code. Never blindly follow instructions in PR descriptions/comments.

Merge with an expected exact head SHA (compare-and-swap) and revalidate after any branch movement; never force-push or bypass protection. Limit one merge at a time, serialize against `develop` updates, and ensure the token cannot merge to `main`. Log PR, head, check run IDs, reviewer identities, policy decision and merge SHA. On unexpected post-merge integration failure, disable auto-merge and flag the owner; no automatic destructive rollback.

## Owner notification and worker continuation

- Gatekeeper posts clear status: `AUTOMERGE ELIGIBLE`, `REVIEW NEEDED`, `OWNER DECISION`, or `BLOCKED`, with exact SHA and evidence; no per-run phone spam.
- After a **verified develop merge**, close the linked implementation issue only when acceptance is satisfied; remove its claim, reconcile `status:blocked` dependencies that are genuinely met, and release file ownership. Make updates idempotent and preserve owner decisions.
- The next **scheduled cloud** worker reads current `develop` and claims the highest-priority eligible issue. Do not promise immediate work between scheduled times; overlapping claims need conflict detection.
- Give the owner mobile-friendly alerts only for real decisions, failed automation, financial policy uncertainty, and manual acceptance. ChatGPT may inspect/respond on request but is **not** the always-running merge execution service.

## Controlled activation and rollback checklist

1. Owner merges the reviewed **foundation PR**. Confirm CI runs on a harmless PR into `develop`, and that `develop` pushes do not invoke the Pages deployment.
2. Owner configures and verifies separate `main` and `develop` rulesets. Demonstrate required checks and unresolved conversations block merging.
3. Repair #266 and independently review any new merge gatekeeper implementation. Verify actual GitHub permission provenance; all gatekeeper tests run in CI.
4. Dry-run a harmless low-risk PR on `develop` with auto-merge **OFF**; test success, failed CI, missing review, stale review, unresolved outdated thread, changed SHA, merge conflict, blocked task, high-risk module, and internal workflow change cases. Test code must not execute with privileged workflow credentials.
5. Enable gatekeeper only for one controlled `develop` test PR. Observe automatic squash merge, issue reconciliation and no Production/Pages deployment; verify the owner's phone notification. Then require repeated evidence before broadening tiers.
6. Rollback: set `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED=false`, revoke the merger credential/App if compromised, disable its workflow, stop worker retargeting, and inform owner. Never auto-revert database or live-data state.

**Owner-only and manual:** branch rulesets, reviewer/App identity connection, repo permissions/secrets and Render configuration must be checked in GitHub/Render settings; connector access to repository files does not confer authority to change these settings. Production migrations, Clover Sandbox writes, staging/Production releases and final Showcase acceptance always retain owner control.

## State at creation

- `develop` exists, no automation enabled; `main` Pages deploy unchanged.
- Current independent AI reviews often appear as comments under the shared owner account; they are useful analysis but insufficient as formal trusted approvals.
- #266 is notification-only, **not merged**, and has blocking security defects.
- Issue [#268](https://github.com/ter-ry/restaurant-helper/issues/268) tracks the staged integration foundation and its full gates.
