# Flowtally Application Boundaries

This repository contains four separate surfaces that should not be confused with one another.

## Archived job tracker

Purpose:

- Historical local job-tracker application, now archived under `legacy/job-tracker/`.
- Preserved only for reference and migration history.

Deployment note:

- The archived service files are not part of the active Flowtally runtime.

## Active OCR helper service

Purpose:

- Lightweight Flask app at the repository root that serves invoice and reconciliation OCR endpoints for the Flowtally frontend.

Start command:

```bash
python app.py
```

Gunicorn entrypoint:

```bash
gunicorn app:app --bind 0.0.0.0:$PORT
```

## Pilot backend

Purpose:

- Authenticated Flowtally backend under `backend/`.
- This is the pilot application that staging should use.

WSGI entrypoint:

```bash
backend.wsgi:app
```

Local start command:

```bash
flask --app backend.wsgi:app run --host 127.0.0.1 --port 5001
```

Gunicorn entrypoint:

```bash
gunicorn backend.wsgi:app --bind 0.0.0.0:$PORT
```

Deployment note:

- `render.pilot-staging.yaml` is the staging-ready repository config for this service.

## Public demo frontend

Purpose:

- Public marketing/demo site in the Vite app.
- Runs with the pilot app disabled by default.

Local start command:

```bash
npm.cmd run dev
```

## Private pilot frontend

Purpose:

- Same Vite app, but with the authenticated pilot routes enabled.

Local start command:

```bash
set VITE_ENABLE_PILOT_APP=true
set VITE_PILOT_API_BASE_URL=http://127.0.0.1:5001
npm.cmd run dev
```

For PowerShell, set the variables with `$env:...` before running Vite.

## Boundary rule

- The pilot backend should always be treated as a separate service from the legacy root app.
- Staging should use `backend.wsgi:app`.
- The archived job tracker should only live under `legacy/job-tracker/`.
- The root Flask app should only be used for the OCR helper until it is deliberately removed or relocated.
