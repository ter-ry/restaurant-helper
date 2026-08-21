# Archived Flowtally Job Tracker

This folder preserves the unrelated local job-tracker application that previously lived at the repository root.

It is archived for reference only and is not part of the active Flowtally runtime.

## What is included

- Legacy Flask app source
- OCR helpers used by the legacy job tracker
- Historical Render configuration
- Local tests
- Static assets and templates
- JobSpy discovery helper code

## Last active commit

See [`LAST_ACTIVE_COMMIT.txt`](LAST_ACTIVE_COMMIT.txt).

## Startup instructions from the archived app

```bash
python app.py
```

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Notes

- Do not treat this folder as the active Flowtally application.
- The active authenticated Flowtally service now lives under `backend/`.
- The archived Render config is preserved here for historical reference.
