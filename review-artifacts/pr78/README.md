# PR #78 operational visual review

These screenshots were captured from the real Pilot workspace with a local Playwright fixture for Harbour Kitchen. The fixture supplies representative draft purchase, daily-close exception/completion, and Square connection states without using customer data or external APIs.

- `purchases-dark-desktop.png` / `purchases-light-desktop.png`: draft review card, price-change review, summary metrics, and purchase history.
- `daily-close-dark-desktop.png` / `daily-close-light-desktop.png`: completed/needs-review progress indicators, open close controls, variance and exception context.
- `square-dark-desktop.png`: synthetic connected state with mapped locations, mapping health, and sales sync.
- `square-disconnected-dark-desktop.png`: disconnected state with actions disabled and no status-card overlap.
- `square-loading-dark-desktop.png`: initial loading shell while API sections are pending.

The dark screenshots use charcoal surfaces and tinted semantic badges; the light screenshots retain readable neutral surfaces. No bright pastel cards or clipped status badges were observed. Remaining visual work is intentionally deferred: Menu Costing layout, Usage / Variance width, packaged-supply seed units, and broader cross-module redesign.
