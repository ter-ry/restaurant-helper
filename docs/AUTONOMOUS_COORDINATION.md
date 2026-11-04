# Autonomous Development Coordination Proposal

Status: review-only proposal. This document does not enable auto-merge, change branch protections, deploy, or grant Clover/production authority.

Dashboard: https://github.com/ter-ry/restaurant-helper/issues/211

## Current audit

Main at review time: `b26913f2021f6755521623c6344b97e2ff595693`.

The active `Protect Main` ruleset (ID `26415188`) currently enforces deletion protection, non-fast-forward protection, a pull request, review-thread resolution, and `backend`/`frontend` status checks. It currently requires zero approving reviews and uses a non-strict required-status policy. The ruleset is active, but the owner must verify the GitHub UI/API settings before relying on it as the release gate.

The repository still has an owner-only merge/deploy boundary. Merging to `main` triggers Pages deployment. Render/backend deployment and production configuration remain outside this proposal.

## Single-owner issue claims

Labels and comments are advisory and are not atomic. The proposed claim primitive is a GitHub ref:

1. An agent requests issue N through a small claim command or issue comment.
2. A trusted GitHub App workflow attempts to create `refs/heads/claims/issue-N` at the current main SHA.
3. GitHub ref creation is the compare-and-set operation: exactly one concurrent create succeeds; every other claimant receives an already-exists conflict and must not create code or a PR.
4. The workflow records the winning agent, branch, timestamp, base SHA and canonical PR in a bot-authored issue comment, then applies `status:in-progress`.
5. The implementation branch is separate (`claude/<topic>` or `codex/<topic>`). The claim ref is never force-pushed and never used as an implementation branch.
6. A second agent may review the issue or existing PR, but may not implement it while the claim ref exists.

Recovery is evidence-based and serialized by the same workflow concurrency group:

- The claimant may release its own claim with a bot command.
- The owner or trusted bot may recover an abandoned claim only when the claim is older than the configured inactivity window, has no open canonical PR with recent commits, and the issue/PR history records the reason.
- Recovery deletes only `claims/issue-N`; it never deletes or force-pushes the implementation branch.
- A new claimant must win a fresh ref-creation race after recovery.

The workflow must reject claims for issues marked `needs-owner`, `status:blocked`, or already linked to an open canonical PR. It must also reject a claim when another claim ref exists, even if the label is stale.

This is preferable to labels/comments alone because the ref-creation response is GitHub's atomic conflict boundary. The bot must use a dedicated GitHub App identity, least-privilege contents/issues/pull-request permissions, and an allow-list of agent identities.

## Review and merge eligibility

Add a separate, fail-closed GitHub App check named `coordination-eligibility` on pull requests. It should run on opened, synchronize, reopened, review-submitted, review-dismissed, review-thread, check-run and workflow-run events, and use the latest pull-request head SHA.

The check is eligible only when all of these are true:

- the PR head is the SHA being evaluated;
- the required `backend` and `frontend` checks passed for that exact SHA;
- a trusted reviewer identity other than the PR author submitted `APPROVE @ <sha>` after the latest push;
- no trusted review on the exact SHA says `REQUEST CHANGES` or `BLOCKED`;
- no unresolved review conversations remain;
- the PR is open, non-draft, targets `main`, has one canonical issue claim, and is not a stale/duplicate PR;
- the issue's dependencies are closed and their implementation PRs are merged;
- no changed path is classified high risk without the owner gate.

The check must compare reviewer login/installation ID with the author login, and must not treat a same-user Codex comment or approval as independent. A review becomes stale whenever the head SHA changes; the check returns failure or pending until a new trusted review covers the new SHA.

High-risk path rules remain owner-gated for:

- financial or POS calculations;
- Clover/Square inventory, refunds, voids, or reversals;
- RLS, tenant isolation, migrations and database locks;
- production/staging configuration, workflows, deployment files and secrets.

For high-risk PRs, the check should report `OWNER_GATE_REQUIRED` and never authorize merge. It must never call the merge API, enable auto-merge, approve a review, change a production flag, or dispatch a deployment. The owner remains the only release authority.

The check should publish machine-readable outputs such as `eligible=false`, `reason_codes=[...]`, `head_sha=...`, and `reviewer_id=...`. Merge eligibility must be derived from that check and branch rules, never from an arbitrary comment.

## Required owner setup

Before enabling this proposal:

- install/configure a dedicated trusted reviewer GitHub App or bot identity;
- set the allow-list of trusted reviewer IDs and agent IDs;
- configure the claim inactivity window and owner recovery identity;
- add `coordination-eligibility` as a required status check in Protect Main;
- decide whether at least one trusted independent approval is required for all PRs;
- keep high-risk owner-gate behavior enabled;
- verify that Pages deployment is the only merge-triggered deployment and that no workflow grants production/Clover authority;
- leave automatic merging disabled until the owner explicitly authorizes it.

## Current queue handoff

- Canonical Daily Close implementation: PR #209. PR #210 is duplicate work; preserve useful tests before closing it.
- Issues #207 and #208 are duplicate descriptions of the finalize persistence defect; keep one canonical issue and close the duplicate only after #209 validation.
- Owner cash policy is recorded on issue #206.
- Clover #167 work is owned by a separate Claude session; do not duplicate it.
- Showcase-only rows stay unverified until dated Showcase evidence exists.
