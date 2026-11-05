# Flowtally agent handoff: safe staged implementation

**Status:** Review-only first stage. This PR provides a *working, read-only*
GitHub PR evaluator and tests, not an autonomous development bot. No events,
reviews, comments, claims, merges, deployments or Clover settings are changed
on merge. Automatic write operations remain prohibited by `AGENTS.md`.

This complements `docs/AUTONOMOUS_COORDINATION.md`. GitHub issues/PRs are
the source of truth; issue #211 is a dashboard, not a lock or approval source.

## What this stage actually does

- `scripts/agent_handoff_audit.py` fetches current PR metadata, exact-head
  GitHub check runs, changed files, comments and reviews using REST **GET only**.
- Validates `backend` and `frontend` check runs at the *current head SHA*.
  A missing, pending, failed or stale check is never treated as green.
- Recognizes exact-SHA `APPROVE @ <sha>`, `REQUEST CHANGES @ <sha>`,
  `BLOCKED @ <sha>`, or formal GitHub review state **only from separately
  authenticated GitHub logins explicitly allow-listed as trusted reviewers**.
  A Codex comment posted under the PR author's GitHub login is *not*
  independent. Without a separate trusted reviewer, the tool stays blocked.
- Identifies obviously high-risk changes and reports `HIGH_RISK_OWNER_GATE`.
  It intentionally treats unknown review-thread resolution, claims and
  dependencies as unverified. Those facts need separate trusted sources.
- Prints a machine-readable advisory with candidate handoff action,
  reason codes and the latest SHA. It always sets
  `eligible_for_automatic_merge=false` and `actions_executed=[]`.
- Adds `.github/workflows/agent-handoff-preflight.yml` with read-only
  permissions. Pull requests touching the evaluator run **unit tests only**;
  live PR audits require manual `workflow_dispatch`. There is **no push,
  review, comment, CI-completion or schedule trigger** for agent handoffs,
  so merely merging cannot start an autonomous development loop.

### How to test it

From a trusted development clone:

```sh
python -m unittest discover -s scripts/tests -p 'test_agent_handoff_audit.py' -v
GITHUB_TOKEN=... python scripts/agent_handoff_audit.py \
  --repository ter-ry/restaurant-helper --pr 209 \
  --trusted-reviewers verified-separate-reviewer-login
```

Never paste tokens into GitHub comments or logs. To run the GitHub Actions
manual read-only check *after owner approval of this PR*, use Actions →
**Agent handoff preflight (manual/read-only)** → Run workflow → enter the PR
number. Set the repository variable `FLOWTALLY_TRUSTED_REVIEWERS` to a
comma-separated list of **actual, independent GitHub reviewer identities**
before relying on approval evidence. An empty variable intentionally means
no trusted reviewers.

The preflight uses GitHub REST GET. It cannot verify unresolved threads or
canonical issue claims, so those remain explicit fail-closed reasons until a
properly permissioned integration is implemented. Do not interpret an advisory
as approval or merge eligibility.

## Staged path to the requested unattended loop (not enabled here)

1. **Owner-controlled reviewer identity.** Connect a functioning Codex review
   integration that posts under a distinct GitHub bot/app identity. Verify its
   actual response to one new PR head SHA. The current author's own comments
   cannot satisfy a formal independent-review gate.
2. **Atomic issue and branch ownership.** Implement single-winner GitHub ref
   creation (`refs/heads/claims/issue-N`) using a least-privilege GitHub App,
   record canonical PR/owner, and verify concurrency. A second session must
   decline to modify the claimed branch. Never infer abandonment from a stale
   comment alone. Owner-authorized recovery must be serialized and logged.
3. **Trusted review and CI events.** The App/orchestrator subscribes to
   `pull_request` synchronization, check completion and independent review
   submissions. It re-reads the latest SHA and uses the evaluator before
   dispatching a **bounded** Claude PR repair or Codex review task. Include
   idempotency keys, per-PR locks, retry/backoff and rate/cost caps to avoid
   duplicate sessions and comment/CI feedback loops.
4. **Completion/next issue routing.** After owner-approved merges, reconcile
   labels/PRs and claim the next dependency-ready `status:ready` +
   `unattended-ok` issue. `status:in-progress`, `needs-owner`, external
   Sandbox and disputed business rules are never auto-claimed. If no work
   exists, report a concise owner-decision queue instead of repetitive
   no-action noise.
5. **Release/merge boundary.** Do not enable auto-merge, auto-deploy or modify
   Protect Main rules by default. High-risk financial, POS, RLS, inventory,
   migration, CI/workflow and deployment changes remain owner-gated. For any
   future automatic low-risk merges the owner must separately approve exact
   scope and enforcement and test a throwaway PR end to end.

## Why this staged approach is necessary

Concurrent Claude sessions previously implemented two incompatible exports
on PR #209. The desired loop must first guarantee **one canonical branch owner
and one current-head review**. The three Clover implementation slices
(#214/#215/#216) merged only after owner authorization; their real Clover
Sandbox semantics are still independently gated by #166. This preflight
does not claim those capabilities are verified.

## Non-goals and safety constraints

No PostgreSQL bootstrap, role creation, shell install, `sudo`, customer data,
external Clover calls, new secrets, reviewer self-approval, force pushes,
issue writes, merges or deployment. The code deliberately has no write path.
The workflow does not relax existing CI or branch protection. Re-review this
design independently before merging or adding automatic triggers.
