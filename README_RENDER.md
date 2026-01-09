# Deploying ismartshop backend to Render.com

This document contains step-by-step instructions to deploy the backend to Render and create a managed Postgres database. It also lists required environment variables and a basic migration plan.

## Summary
- Create a new **Web Service** on Render pointing to this repository (or a fork) and using the `backend/` folder as the root.
- Create a new **Postgres** instance on Render and set its connection string as `DATABASE_URL` for the web service.
- Set environment variables (SESSION_SECRET, FRONTEND_URL, BACKEND_URL, SMTP_*, FROM_EMAIL) in the Web Service settings.

## Web Service settings
- Root directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment: `Node` (select the latest LTS)

## Environment variables (set these in Render -> Service -> Environment)
- `SESSION_SECRET` — a long random secret for JWT signing.
- `FRONTEND_URL` — e.g. `https://webdev-it.github.io/ismartshop` (used for CORS + verification redirects).
- `BACKEND_URL` — your render service URL, e.g. `https://ismartshop-backend.onrender.com` (optional, used for email links).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — SMTP credentials for sending verification and admin emails (optional but recommended).
- `FROM_EMAIL` — the from address used for outgoing emails.
- `DATABASE_URL` — the Postgres connection string (set after creating the database on Render).

If you do not set `DATABASE_URL`, the server will fall back to file-based JSON storage in `backend/data/` (development mode).

## Creating the Postgres database on Render
1. In Render, click New -> PostgreSQL.
2. Choose a name (e.g. `ismartshop-db`) and the plan (Starter is fine for dev).
3. Create the database. When ready, copy the `DATABASE_URL` connection string.
4. Add `DATABASE_URL` to your Web Service environment variables.

## Migration plan (file -> Postgres)
You can migrate data from the current file JSON store to Postgres in two ways:

Option A — Quick script (using `pg`):
- Add `pg` to `package.json`.
- Write a small Node script that reads `backend/data/*.json` and inserts rows into tables.
- Run the script once on Render (via a temporary deploy command or an administrative one-off job).

Option B — Prisma (recommended for long-term):
- Add Prisma to the project, create a schema, generate the client, and run migrations.
- Convert the current read/write helpers in `server.js` to use PrismaClient.

If you want, I can implement Option A (small migration script) or set up Prisma and provide a migration.

## render.yaml (example)
You can use an infrastructure file `render.yaml` to define service + database as code. Example `backend/render.yaml` is included in this repo — adjust names before applying.

## Post-deploy checks
- Visit `https://<your-backend-url>/api/health` to ensure the service is online.
- From your frontend (GitHub Pages) set `window.ISMART_API_BASE` to your backend URL, or update the frontend to point to the backend URL.
- Register a test user via `POST /auth/register` and verify the email flow if SMTP is configured.

## Next steps I can help with
- Update the frontend admin UI to support login and use JWT/cookie authentication.
- Implement Postgres-backed storage and a migration script.
- Create a `render.yaml` matching your Render account naming and apply it.

Tell me which of the above you'd like me to implement next (update admin UI auth, implement DB migration script, or create render.yaml and apply it).