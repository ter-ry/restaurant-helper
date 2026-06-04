# Restaurant Admin Helper

Restaurant Admin Helper is an early local product concept for independent restaurants in Toronto/GTA. The landing page is built for outreach and feedback around repetitive restaurant admin work: supplier invoices, daily close records, delivery payouts, expenses, and reports.

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

Open the Vite URL, usually:

```text
http://127.0.0.1:5173/
```

## Environment Variables

Create a local `.env` file only when needed:

```text
VITE_FORM_ENDPOINT=
VITE_BASE_PATH=
```

`VITE_FORM_ENDPOINT` is optional. When it is empty, the forms stay in demo mode and show a local success message without sending data.

`VITE_BASE_PATH` is optional. GitHub Actions automatically sets the Vite base path from the GitHub repository name. Use this only if you need to override the deployment path.

## Build

```bash
npm run build
```

## GitHub Pages Deployment

The workflow is in `.github/workflows/deploy.yml`.

To deploy:

1. Push the repo to GitHub on the `main` branch.
2. In GitHub, open **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` or run the workflow manually from the **Actions** tab.

The workflow installs dependencies with `npm ci`, runs `npm run build`, copies `dist/index.html` to `dist/404.html` for client-side routes, and deploys `dist` to GitHub Pages.

## Form Setup

The current forms keep the same UI and submit through `src/lib/formSubmission.ts`.

To connect a backend:

1. Create a Formspree form, Supabase Edge Function, Google Apps Script endpoint, or custom API.
2. Set `VITE_FORM_ENDPOINT` to that endpoint.
3. Deploy again.

The form sends a JSON POST body. Do not ask restaurants to submit private financial data. General workflow feedback is enough.

## Analytics Setup

Analytics hooks live in `src/lib/analytics.ts`.

Tracked events:

- `cta_tell_wastes_time_click`
- `cta_see_what_gets_checked_click`
- `cta_request_review_fit_click`
- `form_started`
- `form_submitted`
- `form_submission_error`

In development, events log to the console. In production, the helper safely checks for Plausible, Google Analytics, or PostHog globals and does nothing if no provider is installed.

## Metadata and OG Image

Metadata is defined in `index.html`.

Placeholder assets:

- `public/favicon.svg`
- `public/og-image.svg`

Before a public launch, replace `public/og-image.svg` with a branded preview image and update the `og:image`, `og:url`, and Twitter image URLs in `index.html` if the final repo or domain changes.

## Privacy / Trust Note

The page states that no private financial data is required, general workflow feedback is enough, sample/fake/blurred data can be used later, and the project is locally built in Toronto/GTA.

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
- Confirm social metadata and favicon are present after build.
