# Domain Setup Notes

Domain:

```text
flowtally.ca
```

## GitHub Pages Setup Notes

The project is prepared for GitHub Pages with:

- `.github/workflows/deploy.yml`
- `public/CNAME`
- metadata in `index.html`
- production OG image path set to `https://flowtally.ca/og-image.png`
- production canonical social URL set to `https://flowtally.ca/`

## CNAME Reminder

`public/CNAME` contains:

```text
flowtally.ca
```

Vite copies files from `public/` into the built `dist/` folder, so GitHub Pages receives the CNAME file during deployment.

## DNS Checklist

Verify manually with the domain provider:

- The domain is registered and active.
- DNS records point to GitHub Pages as required by GitHub's current instructions.
- Any old parking or forwarding records are removed if they conflict.
- Both apex domain and `www` behavior are intentionally configured.
- DNS propagation has completed.

Do not invent DNS records here. Follow the current GitHub Pages custom domain instructions in the repository settings.

## GitHub Repository Checklist

- Open the repo settings.
- Go to **Pages**.
- Confirm source is **GitHub Actions**.
- Set custom domain to `flowtally.ca`.
- Wait for DNS check to pass.
- Enable HTTPS when GitHub allows it.
- Run the deploy workflow again after domain verification if needed.

## Launch Checklist

- `npm run build` passes.
- GitHub Actions deploy succeeds.
- `https://flowtally.ca/` loads.
- `https://flowtally.ca/pilot` loads or redirects correctly through SPA fallback.
- Favicon loads.
- Social preview image loads.
- Header nav works.
- Primary CTA scrolls to contact form.
- Secondary CTA opens early pilot page.
- Form works in demo mode.
- Form backend is connected before serious outreach.
- Instagram profile link points to `https://flowtally.ca/`.
- Recheck copy on mobile before DM outreach.

