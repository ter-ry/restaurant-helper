# Ruleset attestation setup (#270)

Status: code and offline tests only. The controller remains disabled and no credential, variable,
ruleset, or live merge is configured by this change.

The `ruleset-observer` job runs from `main` in a separate `ruleset-observer` environment. Its
credential may read rulesets with the permission GitHub requires to expose `bypass_actors`; it
must be a separate identity from the merge, reviewer, and verifier Apps. The job signs the full
active ruleset response for `main` and `develop` with an Ed25519 key and publishes a 15-minute
artifact. The merge job receives only the artifact and public key. A signature does not make an
observer unprivileged: the observer credential is a privileged owner-controlled secret and must be
kept out of the `develop-automerge` environment.

## Owner checklist

1. Create a dedicated observer App or token, installed only on `ter-ry/restaurant-helper`. Grant
   only the least permission GitHub requires to read complete ruleset details. Do not reuse the
   merge, reviewer, or verifier identity. Record its numeric App ID as
   `FLOWTALLY_RULESET_OBSERVER_APP_ID`.
2. Generate an Ed25519 signing key in the owner-controlled observer context. Store the private
   key only as `FLOWTALLY_RULESET_OBSERVER_PRIVATE_KEY` in the `ruleset-observer` environment.
   Store its base64url public key as `FLOWTALLY_RULESET_ATTESTATION_PUBLIC_KEY` (repository
   variable or the same restricted environment). Never put the private key in the merger job.
3. Store the observer credential as `FLOWTALLY_RULESET_OBSERVER_TOKEN` in `ruleset-observer`.
   Restrict that environment to the trusted `main` branch. Keep all automerge and trusted-review
   switches false while validating setup.
4. Confirm the observer output contains both exact active ruleset ID sets, complete rule
   parameters, `enforcement: active`, and explicit `bypass_actors: []`. Any denied, omitted,
   changed, nonempty, malformed, or truncated response must fail the observer and prevent the
   controller job from starting.
5. Dispatch the workflow in dry-run mode and inspect the sanitized output. Then run the required
   negative tests (expired or modified artifact, wrong repository/App ID, changed ruleset set,
   nonempty bypass, and missing public key). Do not enable live writes based only on a green CI
   run.

## Reversible rollback

Set `FLOWTALLY_DEVELOP_AUTO_MERGE_ENABLED=false` and
`FLOWTALLY_DEVELOP_AUTO_MERGE_LIVE_WRITES=false`, revoke the observer token, delete the observer
private key and remove the observer environment variables. Rotate the Ed25519 key if the artifact
or public key may have been exposed. The controller rejects missing or stale evidence, so removal
of the observer credential is fail-closed.

## Remaining owner gates

The owner must still configure and independently verify the `main` and `develop` rulesets (no
bypass actors; required approvals and stale-review dismissal; strict backend/frontend/trusted
review checks), execute a harmless docs-only develop dry run, and separately authorize one
develop-only live squash merge. No main merge, deployment, or production write is authorized by
this document.
