# Manual trusted integration verifier

This is a one-time, owner-triggered path for PR #387 only. It does not change
the Tier 0 automatic reviewer, merge rules, App permissions, secrets, or any
branch settings. It is disabled unless the owner dispatches the workflow and
the protected verifier environment variable
`FLOWTALLY_MANUAL_TRUSTED_REVIEW_LIVE_WRITES` is exactly `true`.

The verifier accepts only an open, same-repository PR #387 at head
`392c26f1a949f798607d6bcb35eee01f0732726e` and base
`4edbc8cafb3bfecd8cc3d67161887b3d9d6e7229`. It checks the pinned merge
parents, equality of the head and main source trees, exact-head/base CI,
exactly the four known historical review threads and their resolved state,
unchanged security controls, and a formal GitHub `APPROVED` review from a
non-author, non-owner human at the exact head. That review must contain the
literal `R1 APPROVE @ <head>` marker and a valid, unexpired Ed25519
attestation using the existing public key.

The verifier App is the only identity allowed to create the final
`trusted-review-verified` check. The workflow never creates an approval and
never merges. Any missing, stale, ambiguous, expired, incorrectly signed or
wrong-App response fails closed.

## Remaining owner actions

1. Have an authenticated independent human reviewer perform and submit the R1
   formal approval on #387 at the pinned head, including the required marker
   and signed attestation block.
2. Confirm the verifier App is installed for this repository with its existing
   checks-write/read-only permissions, and configure the protected verifier
   environment and public-key variable. Because GitHub filters `bypass_actors`
   from the verifier App, also obtain a fresh signed document from the existing
   ruleset observer and configure its public key and observer App ID as the
   three `FLOWTALLY_RULESET_*` variables. A missing, stale, forged or expired
   observer document blocks the run. Keep the live-write variable unset or
   false during dry run.
3. Dispatch this workflow as `ter-ry` with the three default pinned inputs,
   inspect the sanitized result, and only if it is independently accepted set
   the environment variable true for this single run. Do not merge or change
   rulesets from this workflow.
