# Flowtally Overnight Pilot Execution

## Current Baseline
- Private `/app` is live and database-backed.
- Purchase draft creation, mapping, receiving, manual adjustments, stock counts, and reorder plans already exist.
- Dashboard links to active draft work.
- Latest known verification before this branch: 22 backend tests passing, production frontend build passing.

## Milestones
- Stock-count hardening
- Reorder-plan orchestration
- Supplier and inventory-item management
- Received-invoice correction flow
- Dashboard operational actions
- Permissions and isolation hardening
- Frontend state and mobile usability hardening
- End-to-end integration coverage

## Acceptance Criteria
- Workflows are usable through `/app`.
- State persists in the database.
- Completed records become read-only.
- Duplicate submissions are safe.
- Tenant and location isolation are enforced.
- Build and tests remain green.

## Completed Work
- Draft purchase, inventory, stock count, and reorder-plan groundwork already exists.
- Dashboard can reopen draft purchases, stock counts, and reorder plans.
- Stock counts now have explicit draft-save concurrency checks, duplicate-finalize safety, inactive-user rejection, inactive item rejection, and a clearer movement-conflict review panel.
- Reorder plans now have a backend draft guard to prevent duplicate active drafts and reuse the existing draft on repeat opens.
- Received invoices can now be corrected through an auditable reversal flow that restores inventory quantities, records correction movements, marks the invoice corrected, and keeps the invoice view-only afterward.
- Inventory-item creation, editing, adjustments, and receipt corrections are now limited to owner/manager access so the pilot keeps mutation rights aligned with management roles.

## Current Status
- Branch: `codex/overnight-pilot`
- Test/build status: backend tests passing (25/25), frontend build passing.

## Important Decisions
- Keep public `/demo` and `/pilot` behavior unchanged.
- Do not modify unrelated docs.
- Use focused commits and push to `origin/codex/overnight-pilot`.

## Deferred Work
- Public deployment is out of scope.
- Unrelated docs remain untouched.

## Blockers
- None yet.
