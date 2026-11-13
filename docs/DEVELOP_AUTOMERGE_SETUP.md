# Develop auto-merge: GitHub protection and merge credential setup (#270)

Status: **documentation and offline-verified code only. Not active.** Nothing here sets a variable, secret, ruleset or merge. Every step below is an owner action in GitHub Settings.

## What GitHub actually returned (read-only, 2026-11-13)

| Call | Result for `develop` |
|---|---|
| `GET /branches/develop/protection` | **404 "Branch not protected"** (classic branch protection is not used; `develop` is guarded by a ruleset) |
| `GET /rules/branches/develop` | Active rules from ruleset `Protect Develop` (id 26858821): `deletion`, `non_fast_forward`, `required_linear_history`, `pull_request` (0 approvals, no stale-review dismissal, thread resolution required, squash only), `required_status_checks` (strict; `frontend` and `backend`, integration 15368) |
| `GET /rulesets/26858821` | `enforcement: active`, `bypass_actors: []` |

Consequence found and fixed in this change: the controller only read classic protection, so against this repository it would always have refused to merge (`PROTECTION_UNAVAILABLE`). It now falls back to the ruleset view (`ruleset_problems`), reading `/rules/branches/develop` plus each contributing `/rulesets/{id}`. Classic protection or rulesets must each be sufficient on their own; the stricter union is never assumed. Fixtures in `scripts/tests/test_develop_automerge_controller.py` are those real responses.

## Gap: the live `develop` ruleset is not yet sufficient (correctly refused)

Against the real ruleset the controller reports `RULESET_REVIEW_COUNT_TOO_LOW`, `RULESET_STALE_REVIEWS_NOT_DISMISSED`, `RULESET_MISSING_REQUIRED_CONTEXTS`. Required owner changes to the `Protect Develop` ruleset:

1. Require at least **1 approving review** and **dismiss stale approvals on push**.
2. Add required status checks `trusted-review-verified` with its source restricted to the **verifier App** (the controller requires the integration id to equal `VERIFIER_APP_ID`) and `trusted-review-security-tests`; keep `frontend`, `backend`, strict.
3. Keep `bypass_actors` empty (a ruleset has no `enforce_admins`; an empty bypass list is the equivalent), enforcement `active`, merge method including `squash`.

Unproven until a live run: whether a GitHub App's `APPROVE` counts toward "required approving reviews" in a ruleset, and whether the required-check source restriction is honoured. The controller additionally demands the pinned reviewer bot's formal approval at the exact head and the verifier check from the verifier App, so it does not depend on either.

## Merge credential (`DEVELOP_AUTOMERGE_TOKEN`, environment `develop-automerge`)

- Used by `.github/workflows/develop-automerge.yml` as `GITHUB_TOKEN`. Store only as a secret of the protected `develop-automerge` environment, never repository-wide.
- Prefer a dedicated GitHub App installation token (or a fine-grained PAT) limited to **this repository only** with: Contents **write** and Pull requests **write** (needed for `PUT /pulls/{n}/merge`), Metadata read, Checks read, Actions variables read, Issues read. Ruleset reads (`/rules/branches/develop`, `/rulesets/{id}`) work with repository read access to a repository you can open; classic protection would need Administration read, which is deliberately not needed now. If a read returns 403 the controller fails closed and the run goes red.
- It must be unable to merge to `main`: `Protect Main` must keep requiring a pull request, approvals and empty bypass actors; the controller itself also hard-codes base `develop`. Do not use an owner PAT with admin rights.
- It must not be the identity that approves PRs. Reviewer and verifier keep separate Apps (see `TRUSTED_REVIEW_RUNTIME_SETUP.md`).
- Merges made with an App or PAT token trigger downstream workflows (unlike the built-in `GITHUB_TOKEN`); `deploy.yml` runs only on `main`, so a `develop` merge does not deploy.

## Activation order (all owner actions)

1. Merge this PR. 2. Harden the `develop` ruleset as above. 3. Create the environment and secret. 4. Set `FLOWTALLY_TRUSTED_REVIEW_ENABLED` and live writes, run a manual dispatch with an explicit `pr_number` for a harmless docs PR, then set `FLOWTALLY_TRUSTED_REVIEW_UNATTENDED=true`. 5. Set `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED=true` and observe dry runs before `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES=true`. Rollback: unset those variables.
