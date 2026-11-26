# Authenticated UI density audit

This refinement uses Menu Costing's recipe editor as the reference case for compact authenticated-workspace layouts.

## Batch 1: this review-only PR

- Shared modal body, tabs, and data-table spacing are reduced without changing touch-target buttons.
- `CompactField`, `CompactFieldGroup`, `compact-form`, and `compact-optional` provide consistent field grouping, proportional controls, and disclosure for secondary fields.
- Menu Costing groups quantity/unit, sizes numeric fields, keeps the cost summary visible, and removes repeated desktop table prefixes while retaining accessible names.
- Purchases, Daily Close, Reports, Square integration/Usage, and Settings adopt the shared density treatment around existing records and filters.

## Deferred overlap boundaries

- Inventory and Stock Counts are deliberately not changed here because the active Stock Counts performance PR (#403) overlaps those surfaces.
- Reorder is limited to audit scope because issue #404 is an open UX work item for that editor.
- Transfers remain an audit-only surface in this batch; no business logic or mutation flow is altered.

## Acceptance checks

- Existing calculations, API requests, validation, permissions, and mutation handlers remain unchanged.
- Desktop and laptop layouts use the available horizontal space; mobile layouts continue to stack.
- Optional fields remain discoverable, essential totals/actions remain visible, and no content is clipped by a fixed-height container.
- Playwright covers Menu Costing at desktop, laptop, and mobile widths; focused frontend tests and the production build are required before review.
