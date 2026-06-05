# FlowTally

FlowTally is a restaurant admin and money-visibility service for independent restaurants, cafes, bakeries, takeout shops, bubble tea shops, food trucks, and small restaurant groups.

Core promise:

```text
Save time on admin and get a clearer view of where money is going.
```

FlowTally is not another POS system, accounting software, inventory software, generic AI software, or just an invoice tracker. It helps organize the records around the tools restaurants already use: POS reports, supplier invoices, delivery apps, paper notes, spreadsheets, and accountant requests.

No fake testimonials, logos, customers, or metrics are included. Demo numbers are labeled as concept/demo data.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- React Router
- Lucide icons
- GitHub Actions / GitHub Pages

## Local Setup

```bash
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173/
```

## Environment Variables

Create `.env` only when needed:

```text
VITE_FORM_ENDPOINT=
VITE_BASE_PATH=
```

`VITE_FORM_ENDPOINT` is optional. When empty, forms stay in demo mode and show a local success message without sending data.

`VITE_BASE_PATH` is optional. The default base path is `/` for `flowtally.ca`. Use this only if you temporarily deploy under a repository subpath.

## Build

```bash
npm run build
```

## GitHub Pages Deployment

The workflow is in `.github/workflows/deploy.yml`.

To deploy:

1. Push the repo to GitHub on `main`.
2. In GitHub, open **Settings > Pages**.
3. Set **Source** to **GitHub Actions**.
4. Confirm the custom domain is `flowtally.ca` when ready.
5. Push to `main` or run the workflow manually from the **Actions** tab.

`public/CNAME` contains `flowtally.ca`, so the built GitHub Pages artifact includes the custom domain file.

## Form Setup

The current forms submit through `src/lib/formSubmission.ts`.

To connect a backend:

1. Create a Formspree form, Supabase Edge Function, Google Apps Script endpoint, or custom API.
2. Set `VITE_FORM_ENDPOINT` to that endpoint.
3. Deploy again.

The form sends a JSON POST body. Do not ask restaurants to submit private financial data. General workflow feedback is enough.

## Analytics Setup

Analytics hooks live in `src/lib/analytics.ts`.

Tracked events:

- `cta_tell_wastes_time_click`
- `cta_join_early_pilot_click`
- `form_started`
- `form_submitted`
- `form_submission_error`

In development, events log to the console. In production, the helper safely checks for Plausible, Google Analytics, or PostHog globals and does nothing if no provider is installed.

## Metadata and OG Image

Metadata is defined in `index.html`.

Assets:

- `public/favicon.svg`
- `public/og-image.svg`
- `public/CNAME`

Before launch, verify that `og:image`, `og:url`, and Twitter image URLs point to the final `flowtally.ca` URLs.

## Privacy / Trust Note

The page states that no private financial data is required, general workflow feedback is enough, sample/fake/blurred data can be used later, and FlowTally is locally built in Toronto/GTA.

## QA Checklist

- Run `npm run build`.
- Confirm landing page loads at `/`.
- Confirm early pilot page loads at `/pilot`.
- Confirm nav links scroll to the right sections.
- Confirm CTA buttons go to the feedback form or pilot page.
- Confirm the feedback form validates required fields.
- Confirm demo form submission shows a success message with no endpoint configured.
- Confirm no horizontal scrolling at mobile widths.
- Confirm reduced-motion preference disables particle motion.
- Confirm social metadata, favicon, and `CNAME` are present after build.
