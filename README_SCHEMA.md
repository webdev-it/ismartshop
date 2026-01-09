# iSmartShop Backend Schema

This file describes the PostgreSQL schema used to persist users, pending verifications,
conversations (threads + messages) and favorites.

Files:
- `migrations.sql` — SQL statements to create the necessary tables and indexes. Use when `DATABASE_URL` is configured.

Key tables:
- `users` — registered users. Fields: `id`, `email`, `name`, `password_hash`, `verified`, `role`, `created_at`.
- `pending_verifications` — temporary storage for registration before verification. Mirrors `data/pending_verifications.json`.
- `threads` — conversation containers. Each thread links to a user and optionally a product.
- `messages` — messages in a thread. Each message notes `from_role` ('user'|'admin'), `text`, and `created_at`.
- `favorites` — per-user saved product ids. Unique constraint on `(user_id, product_id)`.

Design notes / migration strategy:
- The current codebase uses JSON files as primary storage. When a Postgres `DATABASE_URL` is provided,
  we'll progressively migrate storage operations to the DB (users, threads, messages, favorites).
- Until DB integration is implemented, code should keep writing to the existing JSON files (`data/*.json`).
- Suggested incremental plan:
  1. Add DB helpers and feature flags to read/write from DB when `db` is available.
  2. Migrate threads/messages: add endpoints to create threads and messages in DB.
  3. Migrate favorites: add DB endpoints to add/remove/list favorites.
  4. Migrate users: keep existing flow but prefer DB for auth/me when available.

Security:
- Password hashing continues to use bcrypt (fallback to pbkdf2) — stored in `password_hash`.
- Do not expose `password_hash` via API responses. Use `auth/me` to return safe profile data.

If you want, I can now:
- Add DB helper functions in `backend/server.js` to operate on these tables when `db` is connected.
- Implement the threads/messages and favorites endpoints to persist into Postgres (with JSON fallback).
