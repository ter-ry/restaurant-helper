# Owner-verified GitHub ruleset bypass attestation

**Status: review-only security remediation for #270. NOT authorization to enable live auto-merge.**

## Why this exists

GitHub's [repository ruleset API](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset) documents that `bypass_actors` is returned **only if the caller has write access to the ruleset**. The dedicated Flowtally merge App deliberately lacks repository Administration(write). The real read-only run [#43749930025](https://github.com/ter-ry/restaurant-helper/actions/runs/43749930025) therefore returned `BYPASS_ACTORS_OMITTED` on both main and develop. This is a GitHub permission boundary, not proof of bypass.

We must not infer that an omitted list is `[]`, remove rules, or give the merge App broad Administration(write) to repair a read-only check.

## Owner-authorized evidence snapshot (November 15, 2026)

The repository owner's separate authenticated GitHub connection retrieved these complete ruleset details:

| Branch | Ruleset | Server `updated_at` | Verified `bypass_actors` | `current_user_can_bypass` |
| --- | --- | --- | --- | --- |
| main | Protect Main (#26415188) | `2026-11-02T20:36:36.327-05:00` | `[]` | `never` |
| develop | Protect Develop (#26858821) | `2026-11-13T17:30:32.692-05:00` | `[]` | `never` |

These are **audited observations**, not a continuous privileged live query and not a signature. The implementation pins this exact set and the source/branch conditions in `scripts/develop_automerge_controller.py`, which is checked out from protected `main` for the action.

## How the fail-closed fallback works

When an actual ruleset response includes `bypass_actors`, it must explicitly equal `[]`; an explicit nonempty list or malformed value is always blocked.

**Only when the field is absent**, the least-privilege App response may use an owner-verified baseline **if all** these conditions are true:

1. The *complete* list of rulesets contributing rules to the branch matches the audited ID set, without extra/inherited/unknown IDs or sources.
2. GitHub's current ruleset response matches the audited, server-maintained `updated_at`, exact ruleset ID, repository source, enforcement, branch scope, and `current_user_can_bypass == "never"`.
3. All the existing independent branch policy rules still pass: no deletion or force push, PR-only, correct approvals/threads, exact status-check IDs (including verifier), and squash-only on develop.
4. Immediately before the sole permitted merge API call, the controller independently re-reads and validates main. Other write paths remain denied.

Changing any ruleset, including its bypass actors, is assumed to update GitHub's server-maintained `updated_at`; stale evidence then fails closed until the owner retrieves the new complete ruleset details, confirms **all** bypass lists are empty, and a separately reviewed main PR updates the baseline. If GitHub omits `updated_at` or `current_user_can_bypass`, the fallback also fails closed. Never auto-refresh the baseline using the restricted token.

### Limits / independent security review required

This mechanism relies on GitHub's update timestamp changing whenever bypass actors change. Security review must explicitly assess that assumption; if it cannot be sufficiently established, **reject this approach** and prefer a separated, narrowly scoped privileged audit/attestation service rather than relaxing validation. It is not a proof that the bypass list was freshly read using the merge App.

Repository-wide `contents:write` is still not branch-scoped. The existing main ruleset requires a PR but **zero formal approvals**. A compromised merge token may be able to create and merge its *own* PR to main after checks, even with no bypass actors. **Main branch hardening with a genuine non-author approval or equivalent protection is a separate activation prerequisite**; do not claim the owner-attested bypass solution alone makes unattended merges production-safe.

## Re-audit procedure

An authorized repository owner, **not the merge App**, reads `GET /repos/ter-ry/restaurant-helper/rulesets/26415188` and `.../26858821`, plus the effective branch rules and any inherited rulesets, and confirms the bypass actor list(s) are explicitly empty. Record the exact latest `updated_at`, scope, active ruleset ID set, checks and provenance in issue #270, then submit an independently reviewed PR to update the pinned baseline. Do not change the App's permission settings or activate live writes as part of re-auditing.

After the remediation PR passes exact-head CI and independent review, repeat Actions `develop-automerge` with `preflight_rulesets=true` and `FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES=false`. Expect both branches PASS. **If BLOCKED, do not disable protection; inspect fixed reason codes and escalate.** Finally complete the trusted reviewer/verifier positive-path and a separately owner-authorized harmless develop-only merge before enabling unattended merges.
