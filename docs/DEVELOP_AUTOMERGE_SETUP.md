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

## Merge identity: a dedicated GitHub App, fresh token every run (no stored token)

The workflow no longer uses any stored `DEVELOP_AUTOMERGE_TOKEN`. On each run, `scripts/develop_automerge_controller.py` signs a short App JWT from the App private key and exchanges it for a single-repository installation token (about one hour, held only in process memory, never written to env, outputs or logs). Nothing is minted while `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED` is not `true` (the job does not even start).

### Owner-only setup (none of this is done by the PR)

1. **Create a new GitHub App** (Settings, Developer settings, GitHub Apps), e.g. `flowtally-develop-merge`. It must be a **new, separate App**: never reuse the reviewer or verifier Apps. Homepage URL can be the repo. Webhook: inactive. "Where can this be installed": only this account.
2. **Repository permissions, and nothing else:** Contents **Read and write**; Pull requests **Read and write**; Metadata read; Checks read; Commit statuses read; Issues read; Actions read; Variables read. Leave Administration, Workflows, Secrets, Environments, Deployments and every account/organization permission at "No access".
3. **Install** the App on **`ter-ry/restaurant-helper` only** (select repositories, not all).
4. **Generate a private key** (PEM) and note the **App ID**.
5. In the repository's **`develop-automerge` environment** (already restricted to `main`): add the **secret** `FLOWTALLY_MERGE_APP_PRIVATE_KEY` with the full PEM. Do not add it as a repository secret, and do not put reviewer/verifier keys or a `DEVELOP_AUTOMERGE_TOKEN` in this environment; the controller refuses to run if any of those names is present.
6. Add the **repository variable** `FLOWTALLY_MERGE_APP_ID` (the numeric App ID; not secret). It must differ from `VERIFIER_APP_ID`.
7. Make sure the merge App is **not** listed as a bypass actor on any ruleset and is **not** a reviewer. Add no deploy keys and no environment bypass.
8. Rollback: unset `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED`, then delete the environment secret and revoke or delete the App key.

### What the controller enforces (fails closed, each case tested)

- The granted permission map of the minted token must **equal** the allowlist above (`MERGE_TOKEN_PERMISSIONS`): any extra permission (for example Administration or Workflows), a missing one, or a higher level is refused (`installation_token_permissions_not_allowlisted:...`). The token must be scoped to exactly this repository (`installation_token_not_single_repo`).
- JWT, installation lookup and token failures raise a fixed-vocabulary reason (for example `unauthorized_app_jwt`, `installation_not_found`, `forbidden:installation_not_updated`) and exit non-zero; no key, token or provider text is printed.
- The merge App id must differ from `VERIFIER_APP_ID`, and the job refuses to run if reviewer/verifier keys, the signing key or a stored merge token are present in its environment.
- Existing restrictions are unchanged: base `develop` only, Tier 0 policy, verifier check and pinned reviewer approval at the exact head, hardened `develop` ruleset, dry-run unless `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES=true`, one merge per run.

### Residual risk: GitHub App permissions are NOT branch-specific

Contents **write** and Pull requests **write** apply to the whole repository, including `main`. A token with them could in principle push to `main` or merge a PR into it if nothing else stopped it. The mitigations are layered and none of them is "the permission is scoped to develop":

1. **Ruleset on `main` (the real control, owner-managed):** require a pull request, block force pushes and deletion, enforcement `active`, **empty bypass actors**. The merge App must not be a bypass actor.
2. **Controller write guard (`GuardedTransport`):** the only write that can leave the process (GraphQL is limited to the constant read-only threads query; mutations are refused) is `PUT /repos/ter-ry/restaurant-helper/pulls/{n}/merge` with exactly `sha` (40 hex) and `merge_method: squash`. Any other method, path, repository or body is refused before sending. Immediately before the first write of a run it also reads `/rules/branches/main` and the contributing rulesets and refuses to write unless they are active, have no bypass actors and include `pull_request`, `non_fast_forward` and `deletion` rules (`WRITE_REFUSED:MAIN_*`). A refused write shows up as `MERGE_NOT_CONFIRMED` and a red run.
3. **Planner:** the PR base must be `develop` at plan time and again immediately before the PUT; the PUT is pinned to the evaluated head SHA.
4. **Environment:** `develop-automerge` allows only `main`, so the private key is never exposed to PR branches. Workflow edits are Tier 2 and owner-merge only.

Limits of the guard, stated plainly:
- It checks `main` rule **types** and empty bypass actors only; it does not inspect `pull_request` rule parameters (for example it does not require approvals on `main`).
- It fails closed if `bypass_actors` is hidden from a token without Administration access, or for organization-level rulesets whose `GET /rulesets/{id}` is not readable. That would refuse every live write (`WRITE_REFUSED:MAIN_RULESET_BYPASS_ACTORS_PRESENT` or `MAIN_RULESET_UNAVAILABLE`). Whether the token can read these fields is **unproven until a live dry-run**; the owner should confirm it before setting `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES=true`.
- The write token is minted in dry-run too (the guard only runs before a write); the token can only be used through the guarded transport.
- Repository-wide contents write also covers other branches and tags that no ruleset protects; only `main` and `develop` are checked.
- That the `develop-automerge` environment allows only `main` is an owner-side setting this repository cannot verify.

This does not protect against a compromised private key used outside this repository's workflow: such a key could act on `main` only as far as the `main` ruleset allows. Hence step 1 and the key rotation/rollback in step 8. Hardening that GitHub cannot express (a branch-scoped App token) is not claimed.

- Merges made with an App token trigger downstream workflows (unlike the built-in `GITHUB_TOKEN`); `deploy.yml` runs only on `main`, so a `develop` merge does not deploy.

## Activation order (all owner actions)

1. Merge this PR. 2. Harden the `develop` ruleset as above. 3. Create the merge App, install it, add the environment secret and the `FLOWTALLY_MERGE_APP_ID` variable (above), and confirm the `main` ruleset has no bypass actors. 4. Set `FLOWTALLY_TRUSTED_REVIEW_ENABLED` and live writes, run a manual dispatch with an explicit `pr_number` for a harmless docs PR, then set `FLOWTALLY_TRUSTED_REVIEW_UNATTENDED=true`. 5. Set `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED=true` and observe dry runs before `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES=true`. Rollback: unset those variables.
