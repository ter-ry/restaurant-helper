# Ruleset bypass visibility and main approval (#270, PR #307)

**Status: review-only. Not authorization to enable live auto-merge.**

## Decision

GitHub omits `bypass_actors` from the least-privilege merge App's ruleset reads (it is returned only to callers with write access to the ruleset;
[docs](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset)). An earlier draft of this PR trusted a pinned `updated_at`
timestamp as a stand-in. Both P1 review findings (Codex and CLAUDE-R1) showed that was not justified:

1. **No proof that `updated_at` changes on every bypass-only edit** (UI, API, inherited rulesets). Tests that edit the timestamp by hand only
   test the comparison. That fallback is **removed**: an omitted `bypass_actors` field stays `BYPASS_ACTORS_OMITTED` / blocked, and only an
   explicit `[]` passes. No pinned baseline exists in code.
2. **Zero-approval main is a merge path for a stolen `contents:write` token.** `main_guard_problems` now returns `MAIN_APPROVAL_NOT_REQUIRED`
   unless every `pull_request` rule on main requires at least 1 approving review (missing, zero, boolean or malformed counts fail closed).

The controller therefore remains fail-closed. The preflight will stay BLOCKED for main and develop until the owner completes the actions below.

## Required owner actions (agents cannot do these)

1. **Raise main's approval requirement** to at least 1 non-author approving review in the `Protect Main` ruleset (a GitHub settings change).
2. **Choose a trustworthy way to see the bypass list.** Preferred: a separate, narrowly scoped, read-only observer (own App or workflow identity
   with ruleset read access, never the merge App and not Administration write for the merge App) that publishes an authenticated attestation
   (for example a signed record the controller verifies against a key held outside the merge job). The attestation must bind ruleset ID, bypass
   list, ruleset hash and a short expiry. Without it, the controller keeps refusing; do not give the merge App Administration(write).
3. Re-run Actions `develop-automerge` with `preflight_rulesets=true` and live writes off, after (1) and (2).

## Not done here

No GitHub settings, App permissions, secrets or live-write switches changed. The attestation observer is not implemented; it needs owner
decisions on the identity and key custody, so it is tracked on #270.

## Tests

`RedactedBypassStaysBlocked` and the extended `unprotected_or_bypassable_main_refuses_the_write` cases in
`scripts/tests/test_develop_automerge_controller.py` cover omitted bypass with matching metadata, and zero/missing/boolean approval counts.

## Minimum-risk path to independent review and verifier acceptance (#270, #280, #268)

Status: plan plus one read-only diagnostic. **Nothing here is active; no setting, secret, key or write changed.** Every GitHub claim below that is not already recorded on #270 is marked UNPROVEN and is settled by the ordered tests, not assumed.

### What is finished offline versus what needs the owner

| Piece | Offline, reviewed code | Needs owner (GitHub UI, secrets, environments) |
|---|---|---|
| Attestation verifier, collector, reviewer/verifier runtime, merge controller, write guard, kill switches | Done on main (#283, #285, #287, #288, #294-#301, #307); 415 offline tests pass | Variables, environment secrets, ruleset edits, Phase 1 live run |
| Bypass visibility | This change: preflight prints `bypass_probe` (GitHub's caller-relative `current_user_can_bypass`, as one fixed word per ruleset id). **Diagnostic only; it never relaxes the block** (`RedactedBypassStaysBlocked` is unchanged and still passes) | Run the preflight; run the two probe controls below |
| Accepting the probe in the guard | Deliberately **not** done: it needs the live controls first, then a reviewed one-function change (`main_guard_problems` and `ruleset_problems`) | Record the control results on #270 |
| Main approval count | Controller already refuses to write unless main requires at least 1 approval | Raise the ruleset (UI step 3) |

### Bypass visibility: chosen design and rejected alternatives

1. **Chosen (no new permission, no new identity):** the merge App is the only identity whose bypass matters for a stolen-token threat. GitHub reports, per ruleset, whether the *calling* identity can bypass it (`current_user_can_bypass`: `always`, `pull_requests_only`, `never`, `exempt`). The owner's connector already returned `never` for both rulesets; whether an **installation token** receives the field, and a truthful value, is UNPROVEN. The preflight now reports what the App token sees. If the controls below pass, a follow-up reviewed change may accept an omitted `bypass_actors` list only when the same token reports `never`, re-read on every run and before the first write. Unlike a pinned `updated_at` it cannot go stale. It does not read other identities' bypass; say so wherever it is cited.
2. **Fallback only on an owner decision:** a separate observer App with Administration **read** only (never the merge App). UNPROVEN that read access returns `bypass_actors` (GitHub documents write access). If it still omits the list, the only remaining observer needs Administration write, which can edit rulesets; that is a larger risk than the one being closed, so do not take it without an explicit `OWNER DECISION:`.
3. **Rejected:** owner-signed periodic attestation (cannot detect a bypass-only edit between signings, and needs daily human re-signing, which defeats unattended use); pinned `updated_at` (rejected in #307); Administration(write) on the merge App.

### Owner UI steps (in order; none is done by this change)

1. **Preflight, read-only:** Actions, `develop-automerge`, Run workflow on `main` with `preflight_rulesets` ticked. Variable `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED` must be `true` for the job to start while `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES` stays unset or `false`. Read `branches[].bypass_probe` in the log. Expected today: `BYPASS_ACTORS_OMITTED` with probe word `never` or `absent`.
2. **Positive control (proves the word can change), without touching a real branch:** Settings, Rules, Rulesets, New branch ruleset `zz-bypass-probe`, enforcement Active, target pattern `zz-bypass-probe-*` (matches no branch), rule Restrict deletions, bypass actor: the merge App (mode Always). From your own machine, mint a merge-App installation token (never in Claude or CI) and `GET /repos/ter-ry/restaurant-helper/rulesets/<probe id>`; record only the `current_user_can_bypass` word. Expected `always`. Remove the merge App from the bypass list, read again, expected `never`. Delete the probe ruleset.
3. **Main approvals:** edit `Protect Main`, Require a pull request, Required approvals = 1. **Solo-owner consequence (owner decision needed, record on #270):** the shared `ter-ry` account authors PRs and cannot approve its own, so a main merge then needs a second human approver account added as a collaborator (recommended) or an explicit, narrowly scoped bypass for the owner. A visible owner bypass is compatible with design 1 only because the probe is caller-relative; it is not compatible with today's explicit `bypass_actors == []` check, so decide before changing it.
4. **Develop ruleset:** keep required approvals 1, dismiss stale approvals on push, require checks `frontend`, `backend`, `trusted-review-security-tests` and `trusted-review-verified` (source restricted to the verifier App), strict, squash only, empty bypass.

### Secrets, variables and App permissions (names only; never paste values anywhere)

| Where | Name | Notes |
|---|---|---|
| Env `flowtally-trusted-reviewer` | secret `FLOWTALLY_REVIEWER_APP_PRIVATE_KEY`, secret `FLOWTALLY_REVIEWER_SIGNING_KEY` (Ed25519 PEM) | generate offline; delete local copies |
| Env `flowtally-review-verifier` | secret `FLOWTALLY_VERIFIER_APP_PRIVATE_KEY`, variable `FLOWTALLY_REVIEWER_PUBLIC_KEY` | public half only |
| Env `develop-automerge` (deployment branch `main` only) | secret `FLOWTALLY_MERGE_APP_PRIVATE_KEY`, variable `FLOWTALLY_MERGE_APP_ID` | the controller refuses to start if any reviewer or verifier key name is present here |
| Repository variables | `FLOWTALLY_TRUSTED_REVIEW_ENABLED`, `FLOWTALLY_TRUSTED_REVIEW_LIVE_WRITES`, `FLOWTALLY_TRUSTED_REVIEW_UNATTENDED`, `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED`, `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES`, `FLOWTALLY_REPO_ID`, `REVIEWER_BOT_LOGIN`, `REVIEWER_BOT_USER_ID`, `FLOWTALLY_REVIEWER_APP_ID`, `VERIFIER_APP_ID`, `FLOWTALLY_CODEX_BOT_USER_ID`, `TRUSTED_COAUTHOR_EMAILS` | all switches start `false` or unset |

| App | Repository permissions (nothing else; installed on `ter-ry/restaurant-helper` only) |
|---|---|
| `flowtally-independent-reviewer` (id 5684233) | Pull requests read/write; Contents, Metadata, Checks, Commit statuses, Issues, Actions, Variables read |
| `flowtally-review-verifier` | Checks read/write; Pull requests, Contents, Metadata, Commit statuses, Issues, Actions, Variables read |
| `flowtally-develop-merge` (separate App) | Contents and Pull requests read/write; Metadata, Checks, Commit statuses, Issues, Actions, Variables read; **no Administration** |

### Ordered acceptance tests (each result recorded on #270/#280; stop at the first failure)

1. Offline: `python -m unittest discover -s scripts/tests` passes on the exact main SHA (415 tests at this change).
2. Merge-App preflight (step 1 above) is read-only and prints `bypass_probe`; no writes.
3. Probe positive and negative control (step 2): `always` then `never`. If the App token never shows the field, stop: the design-1 acceptance change is not justified; use the owner decision for the fallback.
4. Main requires 1 approval (step 3); preflight shows `MAIN_APPROVAL_NOT_REQUIRED` gone.
5. Reviewer and verifier dry runs with `FLOWTALLY_TRUSTED_REVIEW_ENABLED=true`, live writes `false`: output matches the real review/check shapes (`user.id`, `commit_id`, check `app.id`).
6. Does a GitHub App `APPROVE` count toward the develop required-approvals rule, and is the `trusted-review-verified` source pinned to the verifier App (UNPROVEN): check on the harmless PR below.
7. Negative cases from design section 11: switch off after a valid approval, expiry with no push (GitHub must block the merge), replayed nonce, stale head or base, check posted by another actor, reviewer token gets 403 on merge.
8. Merge-App write guard dry run (`FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED=true`, live writes off): plan names the PR and refuses nothing it should allow, writes nothing.

### First safe controlled dry run

Use PR #296 (docs-only note into `develop`, the existing Tier 0 test). With the switch `true` and live writes `false`, dispatch `trusted-review` with `pr_number=296` and read the printed plan. Only after tests 2 to 5 pass and you record an `OWNER DECISION:` for exact head, set live writes `true`, dispatch once for #296, confirm exactly one formal `APPROVE` and one `trusted-review-verified` success, then set both variables back to `false`. Auto-merge stays off throughout; the first merge is a separate decision.
