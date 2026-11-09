# PR owner-notification gate

This is a review-only, opt-in gate. It reads the current PR head, exact-head
check runs, mergeability, formal review provenance, required policy checks and
review findings. It never merges, deploys, pushes to `main`, changes live data,
or enables Clover inventory. It does not execute pull-request code: the
workflow runs trusted default-branch code through `pull_request_target` and
does not check out the PR head.

## Configuration

Set repository variables, but keep `FLOWTALLY_OWNER_GATE_ENABLED=false` until
the controlled delivery test succeeds:

`FLOWTALLY_OWNER_LOGIN`, `FLOWTALLY_TRUSTED_REVIEWERS`,
`FLOWTALLY_REQUIRED_CHECKS` (default `backend,frontend`),
`FLOWTALLY_RELEASE_POLICY_CHECKS` (optional), and
`FLOWTALLY_OWNER_GATE_WRITE` (`true` only after verification).

High-risk changes are detected by explicit repository path coverage (the same
classifier as `scripts/agent_handoff_audit.py`: `backend/`, workflows, render
and Procfile, daily-close code, `AGENTS.md`), plus a keyword backstop for
financial, inventory, POS, security and migration paths. Set
`independent_reviews_high_risk` in a local snapshot/configuration if the
repository requires more than one distinct trusted formal approval. A
same-account Claude/Codex comment is never a second approval.

Fail-closed evidence: unresolved review threads (including outdated ones) and
outstanding user/team review requests block readiness; a GraphQL error,
malformed response or incomplete pagination reports
`UNRESOLVED_FINDINGS_UNVERIFIED` and never notifies. A withdrawn notification
no longer deduplicates, so a PR that becomes ready again at the same SHA is
re-notified. Removing an already-absent label is treated as success.

Offline regression tests (`scripts/tests/test_pr_owner_gate.py`) run in GitHub
CI via `.github/workflows/pr-owner-gate-tests.yml`.

## Controlled activation

1. Open a private test PR with a harmless documentation change and a known
   passing check set. Run this workflow manually with its PR number while the
   gate is in dry-run mode; inspect the log for the exact SHA and notification
   body.
2. Set `FLOWTALLY_OWNER_GATE_WRITE=true`, then repeat on the test PR. Confirm
   the `owner-review-needed` label and one concise `@OWNER` issue comment.
3. Confirm the owner receives the GitHub Mobile notification on the phone and
   record the time and PR in the PR description. Delivery is not considered
   verified from an API response alone.
4. Only then set `FLOWTALLY_OWNER_GATE_ENABLED=true`. Routine CI progress and
   already-known blocked states do not notify. New head SHAs invalidate prior
   readiness and withdraw the stale label/comment.

## Rollback

Set `FLOWTALLY_OWNER_GATE_ENABLED=false` immediately. Set
`FLOWTALLY_OWNER_GATE_WRITE=false` if a dry-run audit is still desired. Remove
the `owner-review-needed` label manually if necessary; no PR is merged and no
production state is changed by rollback.
