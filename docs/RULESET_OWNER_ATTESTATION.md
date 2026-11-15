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
