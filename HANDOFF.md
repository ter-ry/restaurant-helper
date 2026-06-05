# FlowTally Handoff

## What Changed

- Completed the FlowTally public rebrand.
- Updated landing page positioning around restaurant admin and money visibility.
- Updated metadata, favicon, OG image, README, and docs.
- Added `public/CNAME` for `flowtally.ca`.
- Added outreach and brand planning docs.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

Push to `main`. The GitHub Actions workflow at `.github/workflows/deploy.yml` builds the app and deploys `dist` to GitHub Pages.

## Configure GitHub Pages

In the GitHub repo:

1. Open **Settings > Pages**.
2. Set **Source** to **GitHub Actions**.
3. Confirm the custom domain is `flowtally.ca`.
4. Confirm HTTPS is enabled after DNS is verified.

## Connect The Form Backend

Set this environment variable in the hosting environment:

```text
VITE_FORM_ENDPOINT=https://your-form-endpoint.example
```

The app sends JSON using `fetch` in `src/lib/formSubmission.ts`. Formspree, Supabase Edge Functions, Google Apps Script, or a custom API can be connected there.

Keep the form limited to workflow feedback. Do not request private financial data.

## Update Copy

Most landing page copy is in `src/pages/LandingPage.tsx`.

The early pilot page copy is in `src/pages/PilotPage.tsx`.

Keep claims honest:

- local conversations
- early pilot
- concept preview
- no fake testimonials
- no fake customers
- no fake metrics

## Update Colors

Primary visual styling is in:

- `src/pages/LandingPage.tsx`
- `src/pages/PilotPage.tsx`
- `src/styles.css`

The current palette is charcoal plus cool/warm neutrals. Keep contrast readable if colors change.

## Update Metadata / OG Image

Metadata lives in `index.html`.

Assets:

- `public/og-image.svg`
- `public/favicon.svg`
- `public/CNAME`

Update `og:image`, `og:url`, and `twitter:image` if the final domain or asset path changes.

## Known Limitations

- Forms require a real `VITE_FORM_ENDPOINT` before submissions are captured externally.
- Analytics requires adding an actual Plausible, Google Analytics, PostHog, or custom provider script.
- The OG image is still a simple generated SVG and can be upgraded before serious outreach.
- The dashboard routes under `/app` remain product-preview/demo surfaces.

## Manual QA Before Publishing

- `npm run build` passes.
- Landing page loads on GitHub Pages.
- `/pilot` loads on GitHub Pages.
- Refreshing `/pilot` works because the workflow copies `index.html` to `404.html`.
- Header nav links scroll correctly.
- CTAs work on desktop and mobile.
- Required form fields validate.
- Demo form success appears when no endpoint is configured.
- Endpoint form success/error states work when an endpoint is configured.
- No private financial data is requested.
- No horizontal overflow at 390px, 430px, 768px, 1024px, and desktop widths.
- Reduced motion preference is respected.
- Favicon, social preview metadata, and custom domain CNAME are present.
