# PR #77 Inventory visual review

These screenshots are rendered from the real `PilotWorkspaceLayout` and `PilotInventoryWorkspace` components at the requested viewports. The harness uses synthetic Harbour Kitchen records and intercepts only the pilot API requests in a local Playwright process; it does not use customer sessions or external services.

- `inventory-dark-desktop.png` — 1440×900, dark default theme
- `inventory-light-desktop.png` — 1440×900, persisted light theme
- `inventory-dark-mobile.png` — 390×844, dark theme with horizontally scrollable table

Regenerate with `node tests/visual/pr77-inventory-visual.cjs` after starting a local preview built with the pilot flags and a local API base URL.
