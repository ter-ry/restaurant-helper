# Mobile QA

Checked target widths:

- 390px
- 430px
- 768px
- 1024px
- Desktop widths

## What Was Checked

- Hero headline stays readable and avoids awkward single-word wrapping.
- Hero height is not forced to full-screen on small mobile screens.
- Product preview remains below the headline on mobile and does not cover primary copy.
- Header CTA and section navigation remain usable.
- CTA buttons either scroll to the contact form or navigate to the early pilot page.
- Form fields use visible labels and large tap targets.
- Required fields are marked with browser validation.
- Background particles remain subtle and do not reduce readability.
- Reduced-motion preference disables particle animation.
- Page uses `overflow-x: hidden` and responsive grids to prevent horizontal scrolling.

## Remaining Notes

- Final visual QA should be repeated in the deployed GitHub Pages URL after the repo name is known.
- Test the configured form endpoint after `VITE_FORM_ENDPOINT` is added in production.
- Replace the placeholder OG image before serious outreach.
