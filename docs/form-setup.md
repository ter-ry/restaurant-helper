# Flowtally Form Setup

Flowtally can collect real leads through Formspree on GitHub Pages. No endpoint is hardcoded in the app.

## Current Forms

There are two public forms:

1. Landing page feedback form at `/#contact`
2. Early pilot form at `/pilot`

Both forms submit through `src/lib/formSubmission.ts` and read this build-time environment variable:

```text
VITE_FORM_ENDPOINT
```

## Demo Mode

If `VITE_FORM_ENDPOINT` is blank:

- no lead is stored
- no email notification is sent
- the visitor sees a yellow notice saying the form is not connected and the note was not saved
- the browser console shows an owner setup warning as soon as the app loads
- local development shows an owner setup note above each form
- typed form data stays on screen so the visitor can copy it into an Instagram DM

Do not use demo mode for real outreach.

## Production Behavior

When `VITE_FORM_ENDPOINT` is configured:

- both forms send a JSON `POST` to the endpoint
- successful submissions show a green confirmation
- failed submissions show a red error message with an Instagram DM fallback
- forms reset only after a real endpoint accepts the submission
- Formspree receives page URL, referrer, user agent, form type, and submitted timestamp
- if the visitor provides an email address, it is sent as `_replyto`

## Formspree Setup

1. Create or log in to a Formspree account.
2. Create a new form named `Flowtally leads`.
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
8. Open the live site at `https://flowtally.ca/`.
9. Submit one test entry through the landing page form.
10. Submit one test entry through `/pilot` after confirming the direct route loads.
11. Confirm both test submissions appear in Formspree.
12. Confirm Formspree email notifications are enabled and going to the right inbox.
13. Delete the test submissions if you do not want them in the lead list.

Do not put private financial data in test submissions.

## Submitted Fields

Landing page feedback form:

- `_subject`: `New Flowtally restaurant feedback lead`
- `_replyto`: set only when the contact field is an email address
- `formType`: `feedback`
- `submittedAt`
- `pageUrl`
- `referrer`
- `userAgent`
- `biggestPain` required
- `contact` required, accepts email or Instagram handle
- `businessName` optional
- `chatOpen` optional
- `_gotcha` hidden honeypot

Early pilot form:

- `_subject`: `New Flowtally pilot list lead`
- `_replyto`: set from `email`
- `formType`: `pilot`
- `submittedAt`
- `pageUrl`
- `referrer`
- `userAgent`
- `email` required
- `businessName` optional
- `_gotcha` hidden honeypot

## Success and Error States

Endpoint connected and accepted:

- feedback form: `Thanks. Your feedback was sent.`
- pilot form: `Thanks. You're on the early pilot list.`

Endpoint missing:

- yellow notice
- no reset
- no stored lead
- visitor is told to send the same note by Instagram DM

Endpoint error:

- red error
- no reset
- visitor is told to use Instagram DM and try again later

## Spam Protection

Implemented in code:

- hidden `_gotcha` honeypot field on both forms
- bot-filled honeypot submissions are silently ignored and not posted to Formspree

Recommended in Formspree:

- enable Formspree spam filtering
- enable reCAPTCHA or Turnstile if spam appears after outreach starts
- block repeated abusive sender patterns in Formspree
- keep the form endpoint out of public docs, screenshots, and Instagram posts
- review the Formspree spam folder daily during the first outreach week

Do not add a visible CAPTCHA before launch unless spam becomes a real issue. It adds friction for restaurant owners coming from Instagram.

## Local Testing

Create a local `.env` file:

```text
VITE_FORM_ENDPOINT=https://formspree.io/f/yourFormId
```

Then run:

```bash
npm run dev
```

Submit test entries and confirm they reach Formspree.

## Launch Rule

Do not start real Instagram DM outreach until:

- `VITE_FORM_ENDPOINT` is configured in GitHub Actions variables
- GitHub Pages has rebuilt after the variable was added
- `https://flowtally.ca/#contact` loads and accepts a test submission
- `https://flowtally.ca/pilot` loads directly and accepts a test submission
- one live landing page test lead appears in Formspree
- one live pilot test lead appears in Formspree
- Formspree notification email arrives for both tests

If any of those are missing, leads can be lost.
