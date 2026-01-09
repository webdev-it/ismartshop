Admin & Postgres integration — iSmartShop

This file explains how to connect the backend to a Postgres database, enable automatic migrations and JSON→DB migration, and how to use the admin panel.

1) Required environment variables

- DATABASE_URL: Postgres connection string (Render provides this). Example:
  postgres://user:pass@host:5432/dbname

- ADMIN_USER and ADMIN_PASS: credentials for the built-in admin login (used by /auth/admin-login). Example:
  ADMIN_USER=admin
  ADMIN_PASS=secret

- SESSION_SECRET: JWT secret used for auth cookies. Example: SESSION_SECRET=replace_this

- FRONTEND_URL and BACKEND_URL: set these to your deployed frontend/backend HTTPS URLs. These help determine cookie `Secure` usage and CORS.

Optional (email):
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL — to enable real email sending (nodemailer). If not provided, set DEBUG_SHOW_CODE=true to receive verification codes in responses during development.

2) Migrations and JSON import

- The server will automatically apply the SQL in `backend/migrations.sql` after it connects to Postgres.
  - This happens automatically when `process.env.DATABASE_URL` is present.

- To import existing JSON data (users, pending_verifications, threads, favorites) into Postgres, set:
  MIGRATE_JSON=true

  With `MIGRATE_JSON=true` the server will attempt to idempotently insert entries from `backend/data/*.json` into the new tables.

Caution: Migration tries to avoid duplicates but you should backup your JSON files first. Use the admin endpoint `POST /admin/db/backup-json` to create backups in `backend/backups`.

3) How chats and favorites are persisted

- Threads and messages: stored in the `threads` and `messages` tables in Postgres. Endpoints:
  - POST /api/threads         -> create a new thread + initial message
  - GET  /api/threads         -> list threads for the currently authenticated user (send cookies or Bearer token)
  - GET  /api/threads/:id/messages -> list messages in a thread
  - POST /api/threads/:id/messages -> post a message to a thread (requires auth). Admin replies notify user by email when available.

- Favorites: stored in the `favorites` table. Endpoints:
  - GET /api/favorites            -> list current user's favorites (auth required)
  - POST /api/favorites           -> add favorite (body: { productId })
  - DELETE /api/favorites/:productId -> remove favorite

When Postgres is not configured, file-based fallbacks are used (data/favorites.json, data/threads.json).

4) Admin panel

- The admin UI is at `/admin` (served by the backend if `frontend/` exists). The admin page authenticates using `/auth/admin-login` and sets the `token` cookie.
- Admin UI features:
  - View counts (users/products/threads)
  - Browse threads and read/respond to them — replies are sent to `/api/threads/:id/messages` as admin messages and (if configured) emailed to the thread owner.
  - Manage users: list, delete, truncate via `/admin/db/*` endpoints
  - Run SQL, VACUUM, backup JSON

5) Recommended deployment steps (Render example)

- Set environment variables in Render dashboard: `DATABASE_URL`, `ADMIN_USER`, `ADMIN_PASS`, `SESSION_SECRET`, `FRONTEND_URL`, `BACKEND_URL`, and SMTP vars if you want emails.
- Optional: set `MIGRATE_JSON=true` for a one-time JSON->Postgres migration.
- Deploy service. The server will run migrations and perform the optional import automatically after startup.

6) Frontend integration notes

- To show a user's chats across devices, the frontend should:
  - Authenticate and obtain session cookie (or JWT bearer token).
  - Call `GET /api/threads` (cookies included or Authorization header) to list threads belonging to the logged-in user.
  - Call `GET /api/threads/:id/messages` to retrieve messages for a thread.
  - Create threads with `POST /api/threads` and append messages with `POST /api/threads/:id/messages`.

- To enable favorites synchronization, use the favorites endpoints above instead of localStorage.

7) Troubleshooting

- If cookies aren't persisting during local dev, ensure `FRONTEND_URL`/`BACKEND_URL` are set appropriately and that `runningOnHttps` (used by cookie config) matches your environment.
- To inspect DB state, use the Admin SQL UI (`/admin`) or `POST /admin/db/execute` (admin-only).

If you'd like, I can:
- Update the main frontend (`frontend/script.js`) to use the new `/api/threads` and `/api/favorites` endpoints automatically on login.
- Run a dry migration now (if you provide DATABASE_URL in this environment) or give guidance for Render.

*** End of file
