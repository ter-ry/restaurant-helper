# Trusted reviewer attestation via GitHub App: design (issue #275, parent #270)

Status: **design only, NOT ACTIVE.** This file adds no workflow, secret, token, branch rule or App call. It does not authorize any review posting, merge or deploy. Related: `AUTONOMOUS_INTEGRATION_RUNBOOK.md`, `DEVELOP_MERGE_POLICY.md` (pure decision contract, #273/#274). The gatekeeper (#270) stays blocked until Phase 1 below has separate explicit owner authorization and a recorded live result.

App: `flowtally-independent-reviewer`, App ID `5684233` (nonsecret, owner-confirmed on #275), installed on `ter-ry` with access restricted to `ter-ry/restaurant-helper`. No key, token or secret has been provided to any Claude session, and none may be requested in an issue, PR or chat.

## 1. Problem

Every Claude coder/reviewer routine and the owner post through the same `ter-ry` login. Therefore a comment such as `APPROVE @ <sha>`, a Codex "no findings" receipt, or any text in a PR is **not** authenticated evidence that a distinct party reviewed the exact head. Installing the App does not by itself change that: an App is only evidence if (a) only a reviewer environment can act as it, (b) its review is bound to an exact head SHA, and (c) the repository rules, not a script's say-so, accept or reject that review.

## 2. Assets, actors and trust boundaries

| Zone | Contains | Trusted? | May hold App key? |
|---|---|---|---|
| Coding workers (Claude/Codex scheduled sessions) | Author code, PR text, comments | **Untrusted** (can be prompt-injected, share `ter-ry`) | **Never** |
| PR content (head code, body, comments, labels text) | Attacker-controllable data | **Untrusted** | n/a |
| Reviewer environment (new, separate) | Reviewer logic, App key access | Trusted, owner-controlled | Yes (only here) |
| Evaluator code | Immutable checkout of default branch (`main`) | Trusted only at a pinned main SHA | No (reads only) |
| GitHub rulesets / required reviews | Enforcement | Trusted (GitHub) | n/a |
| Owner | Merges to `main`, rulesets, secrets | Trusted | Owns key |

Trust boundaries: coder -> GitHub (data only); GitHub -> reviewer environment (event is a trigger, never a credential); reviewer -> GitHub (App installation token, minimum scope). The merge actuator (#270) is a separate component, off by default, and is not given the App key.

## 3. Threat model (STRIDE-style, mapped to fail-closed tests)

| # | Threat | Control | Test id |
|---|---|---|---|
| T1 | Shared-account forged comment `APPROVE @ sha` | Only a **formal PR review whose `user` is the App bot** (`flowtally-independent-reviewer[bot]`, and `performed_via_github_app.id == 5684233`) counts. Comments and `ter-ry` reviews never qualify | `forged_shared_account_comment` |
| T2 | Prompt injection via PR text/title/comments | Reviewer treats all PR text as data; decisions come from structured API fields; PR text is never executed, never in a privileged prompt as instruction | `untrusted_pr_text` |
| T3 | Author self-review | Reviewer refuses when the PR author, last pusher or any commit author/co-author equals the reviewing identity or the attested session id | `author_self_review` |
| T4 | Stale head/base | Review `commit_id` must equal live head SHA and base SHA at decision time; any push dismisses (ruleset "dismiss stale approvals") and attestation is invalid | `stale_sha`, `stale_base` |
| T5 | Missing/expired attestation | Attestation has an expiry (<= 1h) and is required; absent or expired -> reject | `missing_attestation`, `expired_attestation` |
| T6 | Spoofed API actor / unauthorized trigger | Verify event `sender`, repository id, installation id, and that a review is by the App id, not by name string | `spoofed_actor` |
| T7 | Unauthorized PR (fork, other repo, base not allowed) | Allow only same-repo PRs, base in an allowlist (`develop` first), non-draft | `unauthorized_pr` |
| T8 | Workflow approval forgery (PR edits the reviewing workflow or the evaluator) | Evaluator and workflow definition load from immutable `main`; any PR touching them, `.github/`, `AGENTS.md`, `CLAUDE.md`, render config, migrations is Tier 2 (never unattended) | `self_modifying_gate` |
| T9 | Code changed after review | Attestation binds the tree/head SHA and the diff hash of the changed-file list; mismatch -> reject | `changed_code` |
| T10 | Failed/missing CI | Require `backend` and `frontend` checks from `github-actions`, exact head and base | `failed_ci` |
| T11 | Pending/unresolved threads (incl. outdated) | GraphQL/REST thread listing must show zero unresolved | `unresolved_threads` |
| T12 | Replay of an old attestation on a new PR/head | Nonce plus (repo, PR number, head SHA, base SHA) binding, single use, stored in the reviewer environment | `replay` |
| T13 | Privilege path from App to merge/deploy | App has no `contents: write`, no `actions`, no `administration`; merging is a different identity, off by default | `no_merge_privilege` |
| T14 | Key theft/leak | Key only in reviewer environment secret store; rotation and revocation below; never in a PR, issue, workflow log or chat | `key_hygiene` (procedural) |
| T15 | Denial/kill | Kill switch variable stops all review posting; absence of attestation is the safe state | `kill_switch` |

## 4. Attestation format

A review is qualifying only if all hold, evaluated by trusted code from `main`:

1. A formal review (`APPROVE`) exists whose author is the App bot, with `commit_id == head_sha`.
2. The review body contains a machine-readable block (JSON) and a detached signature or, for Phase 1, an HMAC computed with a secret held only in the reviewer environment (never in the repo). Fields: `repo_id`, `pr`, `head_sha`, `base_sha`, `changed_files_sha256`, `reviewer_session_id` (random per reviewer run), `author_session_ids` (those found on the PR), `nonce`, `issued_at`, `expires_at`, `evaluator_main_sha`.
3. `reviewer_session_id` not in `author_session_ids`; reviewer environment differs from every coding worker environment (distinct runtime, distinct secrets).
4. The verifier first checks the kill switch (section 9), then recomputes `changed_files_sha256` from the live API, checks the nonce is unused, checks expiry, then records the nonce. The kill switch is re-read immediately before every acceptance and before any actuator action, so an attestation issued before the switch was turned off is rejected.

5. The verifier publishes its result as an **App-bound required status check** (for example `trusted-review-verified`, created only by the verifier identity, bound to the exact head SHA). GitHub rulesets enforce approvals and checks, not custom review-body content, so the verifier's check, not the bare approval, is the enforced prerequisite.

Open design point for the owner: whether to prefer asymmetric signing (the reviewer signs, the verifier holds only a public key) over HMAC. Recommended default: asymmetric (Ed25519), so the verifier cannot forge attestations.

## 5. Reviewer/author segregation

- Reviewer runs in an environment unavailable to coding workers: no shared secrets, no shared checkout, no shared prompt context carrying author reasoning beyond the diff.
- The reviewer's input is the exact-head diff fetched through the API; it never executes PR code with the App token.
- Author identity derived from commits, PR author, last pusher and the HEAD UPDATE session names. If any can't be determined, fail closed.
- No agent approves its own PR; one reviewer session cannot also be the claim holder on that issue.

## 6. GitHub App configuration (minimum)

Repository permissions (least privilege; verify each against the current REST docs for "Create a review for a pull request" before configuring):

| Permission | Level | Why |
|---|---|---|
| Pull requests | Read & write | Post formal reviews, read threads |
| Contents | Read | Read diff/files at head |
| Metadata | Read | Mandatory |
| Checks / Commit statuses | Read | Read CI results (reviewer App is read-only here; it must not be able to publish the verifier check) |
| Issues | Read (write only if posting issue comments is required later) | Labels/claims |
| Everything else (Actions, Administration, Workflows, Secrets, Deployments, Contents write) | **No access** | No path to merge/deploy/workflow edit |

**Separate verifier App (recommended, to be provisioned by the owner).** The mandatory `trusted-review-verified` result must be published by a *different* App identity (for example `flowtally-review-verifier`) so that a compromised reviewer App cannot approve and also vouch for itself. The verifier App needs Checks: write (create check runs; per GitHub's "Create a check run" REST docs) on this repository only, plus Pull requests: read, Contents: read, Metadata: read, Checks/Statuses read for CI. It has no review-posting, contents-write, Actions, Administration or merge permission, its own private key held in the verifier environment (never the reviewer's), and its own App ID, which the ruleset binds as the only permitted source of the required check. The reviewer App never holds Checks/Statuses write. Alternative if the owner prefers one App: grant that App Checks write, and accept that reviewer and verifier then share one compromise domain (not recommended; record the decision as an `OWNER DECISION:`).

Subscribe to no events in Phase 1 (dry-run is invoked manually by the owner). Installation scope: this single repository only; "only on this account". Disable user-to-server OAuth and device flow unless needed; no webhook secret needed until Phase 2.

Authentication and token handling (per GitHub docs "Authenticating as a GitHub App installation" and "Generating an installation access token for a GitHub App"; confirm current wording at implementation time):

- The App authenticates with a short-lived JWT (<= 10 minutes) signed by the private key, then exchanges it for an installation access token that expires after 1 hour.
- Request the token with `repositories` and `permissions` narrowed to this repo and the minimum above; mint per run, never persist, never log; discard after use.
- Pull Request Reviews: a review by an App can be `APPROVE`/`REQUEST_CHANGES`/`COMMENT` via `POST /repos/{owner}/{repo}/pulls/{n}/reviews` with `commit_id` set to the exact head SHA.

## 7. Key storage and rotation

- Private key (`.pem`) is generated and held by the owner; stored only in the reviewer environment's secret manager (or a GitHub Environment with required reviewers scoped to a dedicated reviewer workflow). **Never** in repository secrets readable by workflows triggered by PRs, never in the coding workers' environment.
- Rotate on a schedule (e.g. 90 days) and immediately on any suspicion; GitHub supports multiple active keys for overlap, then delete the old one.
- Revocation: delete the key in App settings, suspend the installation, or uninstall. Document the runbook for the owner.
- No Claude session needs or should hold the key; setup is owner-only.

## 8. Enforcement in GitHub (must be proven, not assumed)

Open question that **must be tested live**: whether a review by this App satisfies "Require approvals" in a ruleset for `develop`, and how "required reviewers/required review from specific actors" treat Apps. Do not presume it counts; Phase 1 includes a test that demonstrates the rule accepts or rejects it.

Because GitHub cannot validate review-body signatures, nonces or expiry, an App approval alone is never sufficient evidence. The ruleset must **also** require the verifier's status check (section 4, item 5), restricted to the verifier's App as its source. The approval satisfies the review count; the verifier check carries the attestation, replay, expiry, kill-switch and segregation results.

Ruleset for `develop` (owner action): require PR; require the `trusted-review-verified` check from the verifier App; require `backend` and `frontend`; require conversation resolution; dismiss stale approvals on push; require last-push approval by someone other than the pusher; block force-push/deletion; no bypass for the App or any bot. `main` stays owner-controlled and is out of this design's scope.

## 9. Kill switch

Repository variable `FLOWTALLY_TRUSTED_REVIEW_ENABLED` (default `false`) checked first by the reviewer; plus App suspension and key deletion as hard stops. Disabled state means no attestations, so every gate fails closed. The switch is also checked by the verifier and the Phase 2 actuator at consumption time, so existing unexpired attestations stop qualifying the moment it is off.

## 10. Two-phase plan

**Phase 1: dry run and standalone proof, owner-controlled.**
1. Owner creates the reviewer environment and stores the key there (owner-only).
2. Owner-run script posts one formal review from the App on a harmless Tier 0 test PR into `develop`, bound to the head SHA, with the attestation block.
3. Run the verifier with the App-bound required status check enabled (the check is mandatory in Phase 1, not a fallback). Observe and record: the review author shows as the App; `commit_id` correct; whether the ruleset counts the approval; and that the **verifier check** (not the ruleset's review count) rejects each negative case in section 11, including missing signature, replayed nonce, expired attestation and kill switch turned off after a valid approval exists. Evidence is posted on #275/#270.
4. If the rules do not count the App approval, or the verifier check can be bypassed or set by another actor, redesign before any Phase 2.

**Phase 2: only after Phase 1 passes and the owner explicitly authorizes.** Integrate with the separate, disabled-by-default #270 merge actuator, using `develop_merge_policy.evaluate` with `trusted_reviewers` and provenance fields populated by the verifier, never from PR content. The merge actuator uses a different identity with no review power; the reviewer uses no merge power.

## 11. Required fail-closed test matrix

Each case must yield no qualifying review and no merge eligibility: forged `ter-ry` comment; untrusted PR text containing `APPROVE`; author self-review; stale head; stale base; missing attestation; expired attestation; spoofed actor name; non-allowlisted base or fork PR; PR editing the workflow/evaluator; changed code after review; failed or missing `backend`/`frontend`; unresolved (including outdated) thread; pending requested reviewer; replayed nonce; App token without merge power attempting merge (must be 403); kill switch on; kill switch turned off after a valid unexpired approval already exists; approval with missing or invalid signature; verifier check set by a non-verifier actor. Offline tests extend `backend/tests/test_develop_merge_policy.py` style (sockets blocked); live tests only in Phase 1 under owner control.

## 12. Owner-only setup tasks (exact)

1. Decide signing scheme (recommended Ed25519) and where the reviewer environment runs.
2. Generate/store the App private key in that environment only; do not share it with any Claude session.
3. Set App permissions per section 6 for the reviewer App, create and install the separate verifier App (Checks: write, repository-only) with its own key in its own environment, and note its App ID for the ruleset source binding; confirm repository-only installation for both.
4. Create the `develop` ruleset per section 8 and run the live acceptance test.
5. Create variable `FLOWTALLY_TRUSTED_REVIEW_ENABLED=false`; enable only for the Phase 1 test.
6. Record outcomes on #275/#270. Phase 2 needs a separate explicit `OWNER DECISION:`.

## 13. Non-goals and constraints

No workflow files, no changes to `AGENTS.md`, the runbook, #266/#274 branches, branch protection, or secrets in this PR. No App token creation or test review calls were made. No merge, deploy, migration or Clover flag involvement.

## 14. References (re-verify current text before implementing)

- GitHub Docs: "Authenticating as a GitHub App installation", "Generating an installation access token for a GitHub App", "Managing private keys for GitHub Apps".
- GitHub Docs: REST "Pull request reviews" (create a review; `commit_id`), "Permissions required for GitHub Apps".
- GitHub Docs: "About rulesets" and "Available rules for rulesets" (required approvals, dismiss stale reviews, last-push approval).
- Not fetched in this session (offline authoring); links above are by title, so confirm exact current behavior at Phase 1.
