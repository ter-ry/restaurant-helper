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

## Current Status
- Branch: `codex/overnight-pilot`
- Test/build status: latest known green before new changes.

## Important Decisions
- Keep public `/demo` and `/pilot` behavior unchanged.
- Do not modify unrelated docs.
- Use focused commits and push to `origin/codex/overnight-pilot`.

## Deferred Work
- Public deployment is out of scope.
- Unrelated docs remain untouched.

## Blockers
- None yet.
