# Trusted review Phase 1: offline components and owner live acceptance (issue #280)

Status: **offline components only, NOT ACTIVE, NOT live-verified.** Design: `TRUSTED_REVIEWER_APP_DESIGN.md` (#275/#276). Code: `scripts/trusted_review_attestation.py`; tests: `scripts/tests/test_trusted_review_attestation.py` (run `python -m unittest discover -s scripts/tests -p 'test_trusted_review_attestation.py'`; needs `cryptography`, already in `backend/requirements.txt`). This adds no workflow, secret, key, token, App call, ruleset or merge path, and does not touch #270 (stays blocked).

## What exists (offline, pure, sockets never used)

- `verify(evidence, config, now, nonces)`: fail-closed evaluation of one PR head. Counts only a formal review whose numeric `user.id` equals the pinned bot id (type `Bot`, pinned login), latest bot review `APPROVED` at `commit_id == head`, carrying one canonical JSON attestation with a valid detached Ed25519 signature. Checks repo/PR/head/base binding, recomputed changed-file digest, TTL <= 1h and expiry, evaluator main SHA, author/session separation (undeterminable authorship fails closed), required `backend`/`frontend` from `github-actions` bound to the exact head and base, zero unresolved (incl. outdated) threads, no pending requested reviewers, same-repo non-draft PR into an allowlisted base, no Tier 2, self-protected (this verifier, its tests, its docs) or invalid paths (reuses `develop_merge_policy.classify_path`), kill switch (`FLOWTALLY_TRUSTED_REVIEW_ENABLED` must be exactly `true`; unreadable variable fails closed), and nonce replay (idempotent for the identical attestation and binding).
- `NonceStore`: model of the verifier-owned store; `consume` is the Phase 2 actuator's job only.
- `plan_verifier_check`: builds the `trusted-review-verified` check-run request; conclusion is `success` only when verified, otherwise `failure` (never `neutral`/`skipped`). `verify_check_source`: models the actuator/ruleset-side rule that a stored check counts only from the verifier App id, for the exact head, unexpired.
- `plan_review_submission` and `sign_attestation`: reviewer-environment dry run that builds the formal-review request (`commit_id` = exact head, `APPROVE`); refuses on kill switch off, self-review, stale payload. `reviewer_permission_problems`: models the no-merge/no-vouching permission rule.
- The module never reads files or environment and never loads a key; the signer receives a key object from its caller and the verifier receives only the 32-byte public key.

Offline coverage maps to the design section 11 matrix (forged `ter-ry` comment, wrong bot id, self-approval, stale head and base, missing/expired/invalid signature, replay, wrong repository, fork/base, Tier 2 path, changed code, failed/missing CI, unresolved outdated thread, kill switch off or unreadable or turned off later, `expiry_without_push`, verifier-cannot-mint, non-verifier check source, idempotent positive control, distinct head/base positive control).

## Limits (do not read this as live acceptance)

- Fixtures are modeled on GitHub's documented response shapes, not recorded live responses. Field names (`user.id`, `commit_id`, thread `is_resolved`, check `app.slug`/`app.id`) must be confirmed against real API output in step 4 below.
- GitHub check runs carry no base SHA. The verifier requires each required run to arrive annotated with `base_sha` by the trusted collector (the base tip the run is known to cover); how the collector derives that, for example from the merge commit or the run's pull request payload, is unproven and must be settled in step 4.
- No code here collects evidence from GitHub. A collector (REST/GraphQL, pagination, rate limits) is a separate trusted component; incomplete evidence must be passed as `incomplete`/`api_errors`, which fail closed.
- The tests are not yet wired into CI: that needs a `.github/workflows/` change, which this issue forbids. Propose a separate gated follow-up.
- Whether GitHub rulesets count an App approval toward "Require approvals", and whether the check source can be restricted to the verifier App, are unproven; that is exactly what step 6 tests.

## Owner-only live acceptance procedure (needs separate explicit owner authorization after independent security review)

1. Pick isolated reviewer and verifier environments, separate from every coding worker. Generate the reviewer Ed25519 keypair there; give the verifier only the raw public key. Generate each App's private key in its own environment's secret manager only. Never paste any key or token into Claude, an issue, PR, CI or log.
2. Reviewer App `flowtally-independent-reviewer` (ID 5684233): Pull requests read/write, Contents read, Metadata read, Checks/Statuses read, Issues read, Variables read, nothing else. Verifier App `flowtally-review-verifier`: Checks write, Pull requests/Contents/Metadata read, Checks/Statuses read, Variables read, nothing else. Both installed on `ter-ry/restaurant-helper` only. Installation alone verifies none of this.
3. Create variable `FLOWTALLY_TRUSTED_REVIEW_ENABLED=false`; record the reviewer bot's numeric user id (Users API on `flowtally-independent-reviewer[bot]`) into trusted verifier configuration, never from a PR; record the verifier App id.
4. On a harmless Tier 0 docs PR into `develop`, with the switch temporarily `true`, run the reviewer dry run, then post one formal review. Confirm the real review object matches the verifier's expectations (`user.id`, `user.type`, `commit_id`, body block) and adjust the collector, not the verifier's checks.
5. Run the verifier; publish `trusted-review-verified` from the verifier App only. Configure the `develop` ruleset per design section 8, restricting the required check's source to the verifier App.
6. Prove live, and record on #280/#270: accept path; each negative case from design section 11 (including switch off after a valid approval, replayed nonce, expiry with no push where GitHub actually blocks the merge, base advanced after a pass, check set by another actor); and that the reviewer token gets 403 on merge.
7. Set the switch back to `false`. Phase 2 (#270 actuator) requires a separate `OWNER DECISION:`.
