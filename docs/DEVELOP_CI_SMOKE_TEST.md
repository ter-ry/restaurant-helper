# Develop CI trigger smoke test

This one-file, review-only change is a controlled non-production check that GitHub Actions runs the existing full backend/PostgreSQL/RLS and frontend CI jobs on a pull request whose base is `develop`.

- No application code, migrations, workflows, Render configuration, flags, or live data are changed.
- The PR is **not** pre-authorized for merge. It is intentionally left open pending a review of the CI evidence and the branch-protection rollout.
- Related integration foundation: issue #268; owner-approved bootstrap PRs #269 and #271.
- Expected: CI workflow `pull_request` on `develop` starts `backend` and `frontend`. `Deploy to GitHub Pages` should not start from this branch or from `develop` pushes, because it triggers only on pushes to `main` or explicit workflow dispatch.
- The develop-only auto-merge gatekeeper (#270) remains disabled.
