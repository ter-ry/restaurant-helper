# Flowtally Analytics Setup

Flowtally supports Google Analytics and Plausible without hardcoding tracking IDs in the codebase.

## Providers

Supported now:

- Google Analytics 4
- Plausible

The app also keeps a no-op PostHog event call available if a PostHog snippet is added later, but PostHog is not loaded by default.

## GitHub Actions Variables

Add these in GitHub:

```text
Settings > Secrets and variables > Actions > Variables
```

### Google Analytics

```text
Name: VITE_GA_MEASUREMENT_ID
Value: G-XXXXXXXXXX
```

Use the real GA4 Measurement ID from the Google Analytics web stream.

### Plausible

```text
Name: VITE_PLAUSIBLE_DOMAIN
Value: flowtally.ca
```

Use the domain configured in Plausible.

## Deploy

After adding or changing either variable:

1. Re-run the GitHub Pages deploy workflow, or push a new commit.
2. Open `https://flowtally.ca/`.
3. Open `https://flowtally.ca/pilot`.
4. Confirm page views appear in GA/Plausible.
5. Click the main CTAs and confirm events appear.

## Page Views

The app tracks SPA page views for:

- `/`
- `/#contact`
- `/pilot`
- any future React Router route

Plausible uses the manual script so route changes are counted by the React app instead of relying only on the initial page load.

## Events

The app currently sends these events:

- `cta_tell_wastes_time_click`
- `cta_join_early_pilot_click`
- `form_started`
- `form_submitted`
- `form_submission_error`

Event properties include context such as:

- `location`
- `form`
- `mode`

## Local Testing

Create a local `.env` file if needed:

```text
VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_PLAUSIBLE_DOMAIN=flowtally.ca
```

Then run:

```bash
npm run dev
```

In development, analytics calls are also logged to the browser console.

## Privacy Notes

- Do not add tracking IDs for services you are not actively monitoring.
- Do not add heatmaps/session replay before outreach unless you add a clearer privacy policy.
- Keep form submissions and analytics separate: Formspree stores leads; analytics tracks traffic and events.
