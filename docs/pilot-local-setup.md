# Flowtally Pilot Local Setup

## Backend

1. Create and activate a Python virtual environment.
2. Install backend dependencies from `backend/requirements.txt`.
3. Set environment variables from `backend/.env.example`.
4. Run migrations:
   - `flask --app backend.wsgi db upgrade`
5. Seed the pilot tenant:
   - `flask --app backend.wsgi seed pilot`
6. Start the backend:
   - `flask --app backend.wsgi run --host 127.0.0.1 --port 5001`

## Frontend

1. Set `VITE_ENABLE_PILOT_APP=true` to open the private pilot routes.
2. Set `VITE_PILOT_API_BASE_URL=http://127.0.0.1:5001` for local development.
3. Start the Vite app with `npm.cmd run dev`.

## Seed accounts

- Owner: `owner@flowtally.local`
- Password: `PilotOwner123!`
- Manager: `manager@flowtally.local`
- Password: `PilotManager123!`

## Manual checks

- `/app/login`
- `/app`
- `/demo`
- `/demo/cafe`
- `/pilot`
