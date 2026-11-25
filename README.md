# Sari-Sari POS

A point-of-sale system for a small sari-sari store, with separate **Admin** and **Sales Representative (cashier)** roles. Built with Node.js, Express, EJS, and PostgreSQL, and deployable to Vercel.

## Features

**Admin**
- Dashboard with sales analytics: today / 7-day / monthly totals, a 7-day sales trend chart, top-selling products, low-stock alerts, and recent transactions
- Product & category management (add, edit, deactivate)
- User management (create/deactivate accounts, assign roles)
- Full sales transaction history with date filtering and receipt detail
- Visibility into every inventory report submitted by cashiers

**Sales Representative (Cashier)**
- POS screen: search/scan products, build a cart, accept cash payment, auto-compute change, print a receipt
- Inventory screen: view current stock and submit reports (restock, damaged, lost, correction)

**Accounts**
- Login at `/login`
- Self-registration at `/register` — anyone can register as Cashier; registering as Admin additionally requires a secret setup code (see [Environment variables](#environment-variables))

## Tech stack

- **Backend:** Node.js, Express
- **Views:** EJS (server-rendered, no build step) + vanilla JS + [Chart.js](https://www.chartjs.org/) (vendored locally in `public/js/vendor/`)
- **Database:** PostgreSQL via [`pg`](https://node-postgres.com/) — works with Neon (via Vercel Storage), Supabase, or any standard Postgres instance
- **Sessions:** [`cookie-session`](https://github.com/expressjs/cookie-session) — the session payload is stored directly in a signed cookie, so there's no server-side session store to manage (required for serverless deployment)
- **Deployment target:** [Vercel](https://vercel.com) (serverless functions)

## Project structure

```
api/index.js           # Vercel serverless entry point (wraps the Express app)
src/app.js             # Express app setup (middleware, routes, error handling)
src/config/db.js       # Postgres connection pool + lazy schema bootstrap
src/db/schema.sql       # Table definitions
src/db/seed.js          # Creates default accounts + sample products
src/controllers/        # Route handlers (admin, POS)
src/routes/              # Express routers (auth, admin, pos)
src/middleware/          # Auth guards, flash messages
src/views/                # EJS templates
public/                    # Static CSS/JS (served directly, no bundling)
vercel.json               # Vercel routing + function config
```

## Prerequisites

- Node.js 22.5+ (matches the `engines` field in `package.json`)
- A PostgreSQL database — any of:
  - The same Neon database you connect in Vercel (via `vercel env pull .env`)
  - A local Postgres instance (Postgres.app, Homebrew, Docker, etc.)
  - Any other hosted Postgres (Neon, Supabase, RDS, ...)

## Local installation

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Then fill in `.env`:

   | Variable | Required | Description |
   |---|---|---|
   | `PORT` | no | Local dev server port (default `3000`) |
   | `SESSION_SECRET` | recommended | Any long random string — signs the session cookie |
   | `POSTGRES_URL` | yes | Postgres connection string (`DATABASE_URL` also works) |
   | `ADMIN_SIGNUP_CODE` | no | Secret code required to self-register as Admin via `/register`. Leave blank to disable admin self-registration (Cashier registration still works; admins are then created from the Admin ▸ Users page) |

   To point `POSTGRES_URL` at your Vercel-connected database before it's deployed, create the database in the Vercel dashboard first (see [Deployment](#deployment-to-vercel) below), then run:

   ```bash
   vercel env pull .env
   ```

   This fills in `POSTGRES_URL` (and other Vercel-managed vars) automatically.

3. **Seed the database**

   Creates the tables (on first connection) plus two default accounts and sample products:

   ```bash
   npm run seed
   ```

   Default accounts:

   | Role | Username | Password |
   |---|---|---|
   | Admin | `admin` | `admin123` |
   | Sales Rep | `cashier1` | `cashier123` |

   **Change these passwords (or re-seed with different ones) before using this with real data.**

4. **Run the app**

   ```bash
   npm run dev     # with auto-reload (nodemon)
   # or
   npm start       # plain node
   ```

   Visit `http://localhost:3000`.

## Deployment to Vercel

1. **Push the code to GitHub** (or another Git provider Vercel supports).

2. **Import the project in Vercel**
   Vercel dashboard ▸ **Add New** ▸ **Project** ▸ select the GitHub repo ▸ Deploy. No build settings are needed — `vercel.json` routes all traffic to the Express app in `api/index.js`, and `public/` is served as static files.

3. **Connect a Postgres database**
   In your project: **Storage** ▸ **Create Database** ▸ choose **Neon** (Serverless Postgres) ▸ connect it to the project for all environments. This injects `DATABASE_URL` / `POSTGRES_URL` automatically. Any other Postgres (Supabase, RDS, ...) also works — just add its connection string as `POSTGRES_URL` under **Settings ▸ Environment Variables**.

   Until a database is connected, the app shows a "Database Not Configured" page instead of crashing.

4. **Set environment variables** *(Settings ▸ Environment Variables)*
   - `SESSION_SECRET` *(recommended)* — a long random string (e.g. `openssl rand -hex 32`). If omitted, a key is derived from the database URL so sessions are still secure, but changing the database would then log everyone out.
   - `ADMIN_SIGNUP_CODE` *(optional)* — lets additional people self-register as Admin.

5. **Redeploy** (Deployments ▸ ⋯ ▸ Redeploy) so the function picks up the new environment variables.

6. **Create your admin account**
   Open your `*.vercel.app` URL and go to `/register`. Tables are created automatically on first request, and while **no admin exists yet, the first account registered becomes the Admin** — no setup code needed. Do this right after deploying. After that, registration defaults to Cashier, and more admins can be added from **Admin ▸ Users**.

   *(Optional)* To load the sample products and default accounts instead, pull the env vars and run the seed script once against the production database:

   ```bash
   vercel env pull .env.production.local
   node -r dotenv/config src/db/seed.js dotenv_config_path=.env.production.local
   ```

### Notes on the serverless setup

- **Sessions** are stored entirely in a signed cookie (`cookie-session`), not server memory — this is required because serverless functions don't share memory between invocations.
- **Views** (`src/views/**`) and `src/db/schema.sql` are explicitly bundled into the function via `vercel.json`'s `includeFiles`, since Vercel's build-time file tracer can't detect EJS's dynamic `fs.readFileSync` calls on its own.
- **Database connections** use a small per-instance pool, and SSL parameters in the connection string are normalized so both Neon and Supabase-style poolers connect without certificate errors.
- **Database schema** is created automatically (idempotent `CREATE TABLE IF NOT EXISTS`) the first time the function queries the database after a cold start — no separate migration step needed for schema changes defined in `src/db/schema.sql`.

## Scripts reference

| Command | Description |
|---|---|
| `npm run dev` | Start the local dev server with auto-reload |
| `npm start` | Start the local server (production-style, no reload) |
| `npm run seed` | Create tables (if needed) and insert default accounts + sample products |

## License

Copyright &copy; 2026 rgrafia (SorSU). Licensed under the [MIT License](LICENSE).
