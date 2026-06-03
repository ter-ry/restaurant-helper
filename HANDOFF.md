# Restaurant Admin Helper Handoff

## What Changed

- Added GitHub Pages deployment workflow.
- Configured Vite base path for GitHub Pages repository deployments.
- Added production metadata, favicon, and placeholder OG image.
- Added endpoint-ready form submission using `VITE_FORM_ENDPOINT`.
- Added success, error, loading, and demo-mode form states.
- Added lightweight analytics hooks without dependencies.
- Added a short trust/privacy note near the feedback form.
- Added small accessibility and mobile-responsiveness refinements.
- Added deployment, form, analytics, and QA documentation.

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

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Run the deploy workflow or push to `main`.

## Connect the Form Backend

Set this environment variable in the hosting environment:

```text
VITE_FORM_ENDPOINT=https://your-form-endpoint.example
```

The app sends JSON using `fetch` in `src/lib/formSubmission.ts`. Formspree, Supabase Edge Functions, Google Apps Script, or a custom API can be connected there.

Keep the form limited to workflow feedback. Do not request private financial data.

## Update Copy

Most landing page copy is in `src/pages/LandingPage.tsx`.

The early pilot page copy is in `src/pages/PilotPage.tsx`.

Keep claims honest. Do not add fake testimonials, fake logos, fake customers, fake usage numbers, or exaggerated product claims.

## Update Colors

Primary visual styling is in:

- `src/pages/LandingPage.tsx`
- `src/pages/PilotPage.tsx`
- `src/styles.css`

The current palette is charcoal plus cool/warm neutrals. Keep contrast readable if colors change.

## Update Metadata / OG Image

Metadata lives in `index.html`.

Replace:

- `public/og-image.svg`
- `public/favicon.svg` if needed

Update `og:image`, `og:url`, and `twitter:image` when moving to a final GitHub Pages URL or custom domain.

## Known Limitations

- Forms require a real `VITE_FORM_ENDPOINT` before submissions are captured externally.
- Analytics requires adding an actual Plausible, Google Analytics, PostHog, or custom provider script.
- The OG image is a placeholder and should be replaced before serious outreach.
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
- Favicon and social preview metadata are present.

## Next Recommended Tasks

- Create the GitHub repo and push `main`.
- Set GitHub Pages source to GitHub Actions.
- Replace the placeholder OG image with a final branded preview.
- Connect Formspree, Supabase, Google Apps Script, or a custom API.
- Add a privacy page only when collecting real outreach data at scale.
- Add a custom domain after the GitHub Pages version is approved.
