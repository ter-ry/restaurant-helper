# FlowTally Form Setup

FlowTally is ready to send landing page and pilot form submissions to a real endpoint, but no endpoint is hardcoded.

Recommended option for GitHub Pages: Formspree.

## Current Behavior

The app reads this environment variable at build time:

```text
VITE_FORM_ENDPOINT
```

If `VITE_FORM_ENDPOINT` is blank, the forms run in preview mode:

- no submission is stored
- no email is sent
- the visitor sees an honest preview-mode message
- the browser console shows an owner setup warning as soon as the app loads
- typed form data is kept on screen so the visitor can still copy it into an Instagram DM

## Formspree Setup

1. Create or log in to a Formspree account.
2. Create a new form for FlowTally.
3. Copy the endpoint URL. It usually looks like:

```text
https://formspree.io/f/yourFormId
```

4. In GitHub, open the repository.
5. Go to **Settings > Secrets and variables > Actions > Variables**.
6. Add a repository variable:

```text
Name: VITE_FORM_ENDPOINT
Value: https://formspree.io/f/yourFormId
```

7. Re-run the GitHub Pages deploy workflow or push a new commit.
8. Submit a test entry on the live site.
9. Confirm the submission appears in Formspree.
10. Confirm Formspree email notifications are enabled if you want email alerts.

Do not put private financial data in test submissions.

## Local Testing

Create a local `.env` file:

```text
VITE_FORM_ENDPOINT=https://formspree.io/f/yourFormId
```

Then run:

```bash
npm run dev
```

Submit a test form and confirm it reaches Formspree.

## Submitted Fields

Feedback form:

- `formType`
- `submittedAt`
- `name` optional
- `businessName` required
- `role` optional
- `businessType` optional
- `problemArea` optional
- `biggestPain` required
- `tools` optional
- `chatOpen` optional
- `contact` required

Pilot form:

- `formType`
- `submittedAt`
- `email` required
- `businessName` optional

## Launch Rule

Do not start serious Instagram DM outreach until a real `VITE_FORM_ENDPOINT` is configured in GitHub Actions variables, the site has been rebuilt, and a test submission is visible in Formspree.

