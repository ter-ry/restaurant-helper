# PR #352 before/after screenshots

Captured with Playwright against production builds (`VITE_ENABLE_PILOT_APP=true`) of `main` (before) and this branch (after), using a mocked API (no live data). Horizontal overflow (`scrollWidth - clientWidth`) measured per page:

| Page | Width | Before | After |
|---|---|---|---|
| Owner audit | 768 | 496px | 0 |
| Owner audit | 390 | 874px | 0 |
| Menu Costing, Imports | 1280/768/390 | 0 | 0 |

Menu Costing "Cost Cost unavailable" / "Contribution Cost unavailable" now read "Cost unavailable" / "Contribution unavailable". The duplicate "Collapse sidebar" header button is removed (the sidebar toggle remains).
