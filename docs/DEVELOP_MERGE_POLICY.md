# Develop merge policy: pure decision contract (issue #273)

Status: **offline preparation only.** `scripts/develop_merge_policy.py` is a pure function over a supplied evidence snapshot. It has no network, token, file, or environment access, no merge actor, and no workflow. Its output never authorizes a merge (`merge_authorized` is always `False`). Parent: #270 (blocked). Runbook: `AUTONOMOUS_INTEGRATION_RUNBOOK.md`.

## API

`evaluate(snapshot, trusted_reviewers=()) -> Decision(decision, reasons, tier, merge_authorized=False)`

Decisions, by precedence: `BLOCKED` > `UNVERIFIED` > `OWNER_DECISION` > `ELIGIBLE_FOR_REVIEW` (candidate only). Reasons are stable codes in a deterministic order. Any `CHANGES_REQUESTED` review in the snapshot blocks (`REVIEW_CHANGES_REQUESTED`). Anything missing, mistyped, duplicated, or ambiguous fails closed (`UNVERIFIED` or `BLOCKED`), never eligible.

## Snapshot fields (all required)

`repository`, `base_ref`, `author`, `head_sha`/`expected_head_sha`, `base_sha`/`current_base_sha`, `draft`, `mergeable`, `api_errors` (non-empty means `UNVERIFIED`), `flags_changed`, `changed_files`, `checks` (`name, head_sha, base_sha, status, conclusion, app_slug`), `threads` (`resolved`; outdated unresolved threads still block), `pending_reviewers`, `reviews` (`reviewer, state, kind, commit_sha, identity_verified, same_account_as_author`), `issue` (`labels, dependencies_closed, file_claim_overlap, linked`).

## Evidence a trusted actor must fetch itself (not from the PR)

- `trusted_reviewers`: from trusted configuration, never from the snapshot or PR text. Empty means no review qualifies.
- Reviewer provenance (`identity_verified`, `same_account_as_author`, `kind`): from an independently attributable reviewer identity or enforced signed attestation. Comments by the shared `ter-ry` account, Codex "no findings" receipts, author self-reviews, and stale approvals never qualify.
- `checks`: from the Checks API with the app that ran them (`github-actions`), matching exact head and current base, for `backend` and `frontend`.
- `expected_head_sha`/`current_base_sha`: re-fetched immediately before acting.
- Issue labels, dependency closure (with PR merged), and file-claim overlap: from live issues and open PRs.
- All data is fetched by trusted code from an immutable `main` checkout; never evaluate PR head code with a privileged token.

## Risk tiers by changed path

- Tier 2 (`BLOCKED`, `TIER2_PATH_CHANGED`): `.github/`, migrations/alembic, `AGENTS.md`, `CLAUDE.md`, `render*.yaml`, `Procfile`, env/secret/auth/deploy/release paths, and this policy, its tests, this doc and the runbook (no self-modification).
- Tier 1 (`OWNER_DECISION`): `backend/**`, `scripts/**`. Owner-controlled in this slice.
- Tier 0: only `docs/**/*.md` (excluding agent instruction files). All other paths, including all of `src/`, are owner-controlled. Agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.claude/`) are Tier 2 at any depth. Invalid paths (`..`, absolute, backslash, non-normalized) are `UNVERIFIED`.
- Changing `CLOVER_ORDER_INVENTORY_ENABLED` or `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED` is `BLOCKED`.

## Tests

`backend/tests/test_develop_merge_policy.py` lives under `backend/tests/` so the existing backend pytest job collects it without a workflow change. It runs offline (sockets are patched to fail).
