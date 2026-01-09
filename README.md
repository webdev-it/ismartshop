# iSmartShop Backend (dev)

This is a minimal dev scaffold for the iSmartShop backend. It serves the static frontend and provides simple API endpoints backed by in-memory sample data. It is intended as a starting point — we'll add PostgreSQL + Prisma, auth, SMTP and admin endpoints next.

Getting started (dev)

1. Copy `.env.example` to `.env` and fill values (DATABASE_URL, SMTP settings, etc.)

2. Install dependencies:

```powershell
cd backend
npm install
```

3. Start the dev server:

```powershell
npm run dev
# or
npm start
```

4. Open http://localhost:3000 (or the port set in `.env`) to view the frontend. The backend exposes:

- `GET /api/health` — health check
- `GET /api/products` — sample product list
- `GET /api/categories` — sample categories
- `GET /admin` — admin placeholder (serves `frontend/admin.html`)

Next steps
- Integrate PostgreSQL and Prisma and migrate sample data to the DB.
- Implement auth (register/login/email verification) and session or JWT flows.
- Implement product/category CRUD endpoints protected for admin role.
- Add threads/messages API and real-time notifications (Socket.IO) for admin chat.
