# Flowtally Design System Specification (proposal, CLAUDE-W2)

Status: **proposal for owner and R1 review. Nothing here is implemented.** Source for #351 and the owner design direction of 2026-11-19 ("make the Owner Reports & Exports design language the standard, in light and dark"). Base: main `920f03d`. Written from the source code of `/owner/reports`; I was not given the owner's screenshots, so the owner must confirm the reference matches before batch 1.

Preview (static, proposed tokens, not the app): `review-artifacts/design-spec/preview.html`, with screenshots `preview-{light,dark}-{1280,390}.png`. The preview table is not the app's phone card layout; existing mobile table-to-card behaviour is kept.

## 1. Audit of what exists

| Finding | Evidence | Consequence |
|---|---|---|
| Colours are hard-coded Tailwind values, not variables | `tailwind.config.ts`: `ink #0F172A`, `muted #64748B`, `line #E2E8F0`, `brand` teal | Dark mode cannot restyle components by token |
| Dark mode is a pile of `!important` overrides | `src/styles.css`: 118 `.pilot-theme-dark ...` rules re-colouring `.bg-white`, `.text-ink`, `.border-line`, `.bg-slate-50` | Fragile; any new utility (e.g. `bg-slate-100`) leaks light colours into dark |
| The same `--pilot-*` tokens are defined 4 times with different palettes | `.pilot-theme` / `.pilot-theme-dark` blocks at lines ~260, ~599, ~1262, ~1341; last one wins (zinc, then neutral, then pure black) | Real dark surface today is `#000000 / #050505`, not layered charcoal |
| Theme exists only inside the authenticated shell | `.pilot-theme-*` is applied by `PilotWorkspaceLayout.tsx`; `/owner/reports`, `/owner/team`, `/owner/audit`, `/imports`, `/integrations/square` use `PageLayout` (`bg-slate-50`) with no theme | Reports is light-only today, so there is no dark Reports reference; two visual products (#351 P1-1) |
| Components bake in light colours | 317 `bg-white`, 599 `border-line`, 1694 `text-ink/muted/slate` across 52 files; `Card`, `Button`, `PageLayout` hard-code them | A token change must be a codemod plus component changes, not CSS only |
| Theme preference is local state only | `PilotWorkspaceLayout.tsx:83` `useState`; toggle in account menu | No system preference, no persistence across pages |

## 2. Proposed tokens (single definition)

Semantic CSS variables on `:root` (light) and `:root[data-theme="dark"]` (dark), defaulting to `prefers-color-scheme`, set on `<html>` so every route, shell or not, gets both themes. Tailwind colours alias them (`bg-surface`, `text-ink`, `border-line`, ...). One definition replaces the four `--pilot-*` blocks.

| Token | Light | Dark (layered slate, not black) | Use |
|---|---|---|---|
| `--bg` | `#F6F7F9` | `#0F141B` | page |
| `--surface` | `#FFFFFF` | `#161C25` | cards, tables |
| `--surface-2` | `#F1F3F6` | `#19212B` | table header, muted panels |
| `--raised` | `#FFFFFF` | `#1D2530` | dialogs, menus |
| `--line` / `--line-strong` | `#E3E7ED` / `#D3D9E1` | `#2A3441` / `#364252` | borders, inputs |
| `--text` / `--muted` | `#0F172A` / `#5B6778` | `#E8EDF3` / `#98A4B3` | text |
| `--accent` / `--on-accent` | `#0F766E` / `#FFFFFF` | `#2DD4BF` / `#06201C` | primary button, active tab, focus |
| `--danger` `--warning` `--success` | `#B42318` `#8A4B08` `#047857` | `#F87171` `#FBBF24` `#34D399` | status text and badge text |
| `--shadow` | two-layer, 5% and 6% slate | two-layer, 30% and 28% black | cards |

Contrast (WCAG, computed): light text 17.9:1, muted 5.7:1, accent 5.5:1, danger 6.6:1, warning 6.8:1, success 5.5:1 on surface; dark text 14.5:1, muted 6.8:1, accent 9.2:1, danger 6.2:1, warning 10.3:1, success 8.9:1 on surface; on-accent text 5.5:1 (light) and 9.2:1 (dark). All meet 4.5:1. Not yet checked: every badge/background pair and focus-ring contrast (3:1) in the real app.

Type, spacing, shape (taken from Reports): page title 30px/700, eyebrow 12px uppercase 700 tracking .06em in `--muted`, section title 17px, body 15px, numbers `tabular-nums`; 16px card radius, 12-14px control radius, 44px minimum control height; card padding 20px, grid gap 16px; page max width 1100-1280px with 20px mobile gutter.

## 3. Reusable component changes (exact)

| Component | Change |
|---|---|
| `Card` | `bg-white border-line shadow-soft` becomes `bg-surface border-line shadow-card` (token shadow); no per-page overrides |
| `Button` | primary uses `--accent/--on-accent` (today `bg-ink text-white`, near-black); secondary `bg-surface border-line-strong`; ghost `text-muted`; keep 44px height and focus ring |
| `Badge` | one neutral style plus three status tones using `--success/--warning/--danger` text on `--surface-2`; remove decorative badges (rule: a badge must state a status the user can act on) |
| `PageLayout` / `SectionHeader` | eyebrow + title + description exactly as Reports; drop the always-on sample/demo chip into the shell's account area; `bg-bg` |
| `StatCard` | label eyebrow, 26px value, one muted line; never `$0.00` for unknown (ties to #351 P0-4/5) |
| `DataTable` | `--surface-2` header, 14px rows, right-aligned tabular numerals, phone card layout unchanged |
| `Modal` | `--raised`, 20px radius; size rules unchanged; full-width editor for New purchase/OCR kept (owner decision) |
| Inputs / tabs | `.input` uses `--surface`/`--line-strong`/accent focus; tabs use accent underline |
| `AppShell` / `Sidebar` | theme applied on `<html>`; sidebar `--surface` with `--line` divider; one set of header controls |

## 4. What can be delivered before the MVP freeze

Recommendation, smallest safe set first; each is its own independently reviewed PR, with 1440/768/390 light and dark screenshots and the full e2e suite:

| Batch | Content | Pre-freeze? | Risk |
|---|---|---|---|
| A | Single token definition (`:root` + `data-theme`), Tailwind colour aliases, theme set on `<html>` with `prefers-color-scheme` default and persisted choice. Light values equal today's so light looks unchanged; dark moves from black to slate | **Yes** | Medium: every dark screen changes at once; mitigated by screenshots and keeping the old overrides until batch C |
| B | Shared components (`Card`, `Button`, `Badge`, `PageLayout`, `SectionHeader`, `StatCard`, `DataTable`, inputs, tabs) on tokens | **Yes** | Medium: used on every page; visual only |
| C | Codemod `bg-white`/`text-slate-*` to token classes, then delete the 118 `!important` overrides | Yes if A and B are clean | Medium-high: mechanical but wide (52 files) |
| D | Move owner pages (`/owner/reports`, team, audit, imports) into the workspace shell | Owner decision needed (routing/gating, #351 P1-1) | Medium |
| E | Page polish: Dashboard, Inventory, Menu Costing, Square/Clover, Daily Close, Purchases list | **Post-freeze by default**; owner may pull any forward | Low each, large in total |

Not changed by any batch: business logic, financial controls, audit evidence, routes, tenant isolation, backend. Purchases editor stays the full-width overlay (#367).

## 5. Open questions for the owner

1. Confirm that the Reports screenshots match section 2 and the preview (page background, card shadow, primary button colour: teal accent vs. today's near-black).
2. Primary buttons teal accent (proposed) or keep near-black in light mode?
3. Approve batches A and B before the freeze, and C only if A and B land cleanly?
4. Approve moving owner pages into the shell (D) before or after the freeze?

## 6. Acceptance for every batch

Before/after screenshots in both themes at 1440, 768 and 390; computed contrast for any new colour pair; no horizontal overflow; keyboard focus visible; full unit and e2e suites green at the exact head; R1 review of the rendered result; owner merges.
