# Flowtally

Flowtally is a restaurant admin and money-visibility service for independent restaurants, cafes, bakeries, takeout shops, bubble tea shops, food trucks, and small restaurant groups.

Core promise:

```text
Save time on admin and get a clearer view of where money is going.
```

Flowtally is not another POS system, accounting software, inventory software, generic AI software, or just an invoice tracker. It helps organize the records around the tools restaurants already use: POS reports, supplier invoices, delivery apps, paper notes, spreadsheets, and accountant requests.

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
VITE_OCR_API_BASE_URL=
OCR_SPACE_API_KEY=
OCR_SPACE_ENDPOINT=
```

`VITE_FORM_ENDPOINT` is optional for local previews. When empty, forms stay in preview mode and do not store submissions. Configure it before Instagram outreach.

`VITE_BASE_PATH` is optional. The default base path is `/` for `flowtally.ca`. Use this only if you temporarily deploy under a repository subpath.

`VITE_OCR_API_BASE_URL` points the invoice upload page at the local Flask backend. Leave it unset for the default `http://127.0.0.1:5000`.

`OCR_SPACE_API_KEY` and `OCR_SPACE_ENDPOINT` are used only by the backend OCR bridge. The browser never sees the OCR API key. The default OCR.space demo key is suitable for light local testing, but it has quota and file-size limits.

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

Recommended setup: [docs/form-setup.md](docs/form-setup.md).

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

The page states that no private financial data is required, general workflow feedback is enough, sample/fake/blurred data can be used later, and Flowtally is locally built in Toronto/GTA.

## QA Checklist

- Run `npm run build`.
- Confirm landing page loads at `/`.
- Confirm early pilot page loads at `/pilot`.
- Confirm nav links scroll to the right sections.

## Invoice OCR

Invoice capture now uses a local Flask endpoint that forwards uploaded invoice files to OCR.space and returns structured fields for review.

Supported uploads:

- `.jpg`
- `.jpeg`
- `.png`
- `.webp`
- `.pdf`

Notes:

- The invoice file is sent to OCR.space for OCR processing.
- API keys stay on the backend and are never exposed in React code.
- OCR results are always shown as extracted data that still needs confirmation.
- Manual entry remains available if OCR fails.

Known limits:

- The default OCR.space demo key is rate-limited and not suitable for heavy production use.
- OCR.space has file-size and PDF page limits on the free tier.
- Very blurry photos, rotated pages, or handwritten invoices may still need manual correction.

To test with your own invoices:

1. Start the Flask app with `python app.py`.
2. Start the frontend with `npm run dev`.
3. Open the invoice capture page in the app.
4. Upload a JPG, PNG, WEBP, or PDF invoice.
5. Review the extracted supplier, date, number, subtotal, tax, total, and line items.
6. Correct any uncertain fields.
7. Check the confirmation box and save.
8. Upload a second invoice from the same supplier to see price history updates.

## Local Job Application Assistant

This repository also includes a local Flask app for tracking and tailoring software, cloud, full-stack, support, implementation, and analyst job applications. It stores data locally in SQLite and does not include auto-submit, scraping bot, login bypass, CAPTCHA bypass, or application automation behavior.

### Setup

Install Python 3.11+ from `https://www.python.org/` if `python` is not available in your terminal.

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5000/
```

### Features

- Profile/settings page with contact info, preferred roles/locations, work authorization, skills, projects, education, work experience, extracted resume text, and a base cover letter template.
- Resume upload for `.txt`, `.docx`, and basic text-readable `.pdf` files. Extracted text can be edited manually.
- Job tracker fields: company, title, location, URL, application URL, source, salary, deadline, remote type, role type, seniority, fit score, status, notes, date added, date applied, required skills, preferred skills, responsibilities, and job description.
- Paste-job-description flow and safe public URL import. Direct scraping of restricted platforms like LinkedIn and Indeed is intentionally disabled.
- CSV import for externally collected job links.
- Detailed scoring for skills match, role match, location/distance, remote/hybrid preference, salary, seniority fit, coding assessment risk, application effort, and overall fit.
- Local generation for tailored resume suggestions, concise cover letter drafts, common application answers, skills match, missing keywords, and unsupported keywords that should not be added.
- Version history for generated resume suggestions, cover letters, and application answers.
- Exports for job tracker CSV plus generated cover letter/resume suggestions as `.txt` and `.docx`.
- Dashboard metrics for jobs saved, applications this week, follow-ups needed, high-fit jobs, average fit score, role/source counts, interview rate, rejection rate, missing salary, and high coding-assessment risk.
- Filtering and sorting by status, fit score, role type, remote/hybrid, coding risk, salary, date added, deadline, and location.
- Follow-up message drafting.
- CSV export at `/export.csv`.

Data is created at `data/jobs.sqlite` the first time the Flask app runs.

### Tests

```bash
python -m unittest discover -s tests
```

The tests cover profile storage/upload, job scoring, generated version history, document export, and CSV import.

### JobSpy Discovery

Automated discovery uses the open-source `python-jobspy` package through `sources/jobspy_source.py`; the app does not implement custom LinkedIn or Indeed scrapers.

Tested and pinned version:

```text
python-jobspy==1.1.82
```

Supported source names:

- LinkedIn: `linkedin`
- Indeed: `indeed`
- Google Jobs: `google`
- ZipRecruiter: `zip_recruiter`

Create saved searches in the Discovery tab. Each saved search stores keywords, location, distance, remote preference, minimum salary, target roles, excluded title keywords, maximum experience, posted-within days, enabled sources, maximum results per source, and Indeed country.

Run the standalone low-volume smoke test:

```bash
python scripts/jobspy_smoke_test.py
```

Discovery results are deduplicated against previous discovery results and tracked applications, passed through hard rejection filters, scored with the existing scoring engine plus discovery-specific freshness/experience/title/source scores, and shown highest-fit first.
- Confirm CTA buttons go to the feedback form or pilot page.
- Confirm the feedback form validates required fields.
- Confirm preview-mode form submission warns that no endpoint is configured.
- Confirm live Formspree submission is captured before outreach.
- Confirm no horizontal scrolling at mobile widths.
- Confirm reduced-motion preference disables particle motion.
- Confirm social metadata, favicon, and `CNAME` are present after build.
