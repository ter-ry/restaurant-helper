# Public Claims Audit (issue #173)

Audited against `docs/RELEASE_STATUS.md` feature confidence on `main` 6735678 (2026-11-03). Scope: `index.html` metadata, `src/pages/LandingPage.tsx`, `src/pages/PilotPage.tsx`. Not audited: `og-image.png` text, Harbour Kitchen demo data, outreach docs (see "Not changed").

| Claim | Where | Status | Action |
|---|---|---|---|
| "delivery payouts, expenses, and reports" | meta/OG/Twitter description | Not a verified feature (no delivery-payout or expense module in the pilot) | Reworded to purchasing/inventory/costing/Square/daily close |
| "Flowtally runs the operational layer between them" | Landing hero | Violates `pre-soft-sell-checklist.md` wording rule | Reworded |
| Square catalog mappings, sales history, theoretical usage | Landing | Automated tests + Showcase (Oct 2026) | Kept ("where supported") |
| Purchasing, receiving, supplier history, price changes | Landing | Automated tests + Showcase | Kept |
| Inventory counts, movements, waste | Landing | Automated tests | Kept |
| Menu & food costing | Landing | Implemented but unverified | Kept; owner to decide whether to label as preview |
| Daily close & reporting | Landing | Implemented but unverified (Square-only) | Kept |
| PostgreSQL row-level security / org isolation | Landing | Automated tests; no independent review | Kept; consider softening until review (#175) |
| "Export-ready records" for accounting | Landing | CSV export only, no QuickBooks sync | Kept; no sync is claimed |
| Clover | Landing | Not mentioned (correct: disabled, unverified) | None |
| "Fully read-only" Harbour Kitchen demo | Landing | Not verified here | Owner to confirm |

## Not changed (owner decision)
- Title/OG title "Restaurant admin and money visibility" (brand positioning).
- `docs/outreach-dm-templates.md`, `docs/instagram-profile.md`, `docs/brand-notes.md` still mention delivery payouts and expenses; reword before any outreach.
- Merging deploys the site; owner must approve the wording.
