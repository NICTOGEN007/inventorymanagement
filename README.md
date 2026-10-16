# StockSmart: Digital Inventory & Sales Management System

A web application for retail stores to manage products, stock, purchases and sales, with
GST-compliant invoicing, AI demand forecasting and an AI assistant.

Built with the **MERN** stack in TypeScript: MongoDB, Express, React and Node.js.

> **Status:** Steps 1–6 of 10 are complete: scaffolding, database and demo data, sign-in with
> roles, the product catalogue, inventory, and purchase orders with deliveries. See the roadmap in
> [docs/PLAN.md](docs/PLAN.md).

## Features (planned)

- **Products & inventory**: SKU/barcode, categories, suppliers, HSN codes, reorder levels, and a full
  stock-movement ledger
- **Point of Sale**: fast billing with barcode search, discounts, cash/card/UPI
- **GST invoicing**: CGST + SGST or IGST chosen automatically from the place of supply; printable invoices
- **Purchases & returns**: purchase orders that add stock, customer returns linked to invoices
- **Reports**: sales, profit, GST summary, stock valuation, low stock; CSV/PDF export
- **AI Smart Restock**: demand forecasting, days-until-stockout and reorder suggestions
- **AI Assistant**: ask questions such as "Which products will run out this week?"
- **Roles**: Admin, Manager and Cashier
- Light and dark mode, works on mobile

## Tech stack

| Layer    | Technology                                                              |
| -------- | ----------------------------------------------------------------------- |
| Frontend | React 19, Vite, Tailwind CSS 4, React Router, TanStack Query            |
| Backend  | Node.js 22, Express 5, Zod, Pino                                        |
| Database | MongoDB 8 (replica set, for transactions) with Mongoose                 |
| Shared   | `@ims/shared`: types, constants, GST and money logic used by both sides |
| Tooling  | TypeScript (strict), ESLint, Prettier, Vitest, Supertest                |
| DevOps   | Docker Compose, GitHub Actions CI                                       |

## Project structure

```
.
├── apps/
│   ├── api/            # Express REST API
│   │   ├── src/
│   │   │   ├── config/      # environment variable validation
│   │   │   ├── db/          # MongoDB connection
│   │   │   ├── middleware/  # error handling, authentication, permissions
│   │   │   ├── models/      # Mongoose schemas (see docs/DATABASE.md)
│   │   │   ├── modules/     # features: auth, users, … (routes + services)
│   │   │   ├── routes/      # route definitions
│   │   │   ├── seed/        # demo data generator
│   │   │   └── utils/       # logger, errors, passwords
│   │   └── test/
│   └── web/            # React frontend
│       ├── src/
│       │   ├── auth/        # session handling, route guards
│       │   ├── components/  # layout and UI building blocks
│       │   ├── lib/         # API client, theme
│       │   └── pages/
│       └── test/
├── packages/
│   └── shared/         # code shared by api and web
├── docs/               # plan, diagrams, report material
├── docker-compose.yml
└── .github/workflows/  # CI
```

## Getting started

### Option A: run everything with Docker (easiest)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
# In a second terminal, load the demo data (one time):
docker compose exec api node apps/api/dist/seed.js --reset --force
```

Open **http://localhost:8080**. The API is also available at http://localhost:4000/api/health.
(`--force` is needed because the Docker image runs with `NODE_ENV=production`.)

### Option B: local development (hot reload)

Requires **Node.js 22+** and Docker (for MongoDB only).

```bash
npm install                       # install all workspaces
cp apps/api/.env.example apps/api/.env
docker compose up -d mongo        # start MongoDB as a replica set
npm run seed                      # load a year of demo data
npm run dev                       # API on :4000, web on :5173
```

Open **http://localhost:5173**. The Vite dev server forwards `/api` requests to the API.

> Using MongoDB Atlas instead of Docker? Put your Atlas connection string in `MONGODB_URI` in
> `apps/api/.env`. Atlas clusters are replica sets, so transactions work.

### Demo data and logins

`npm run seed` simulates a year of trading for a supermarket in Bengaluru: about 12,000 GST
invoices, 800 purchase orders, returns, and a full stock ledger, with weekly, seasonal and festival
demand patterns. Details are in [docs/DATABASE.md](docs/DATABASE.md#demo-data).

| Role    | Email                     | Password      |
| ------- | ------------------------- | ------------- |
| Admin   | `admin@stocksmart.test`   | `Admin@123`   |
| Manager | `manager@stocksmart.test` | `Manager@123` |
| Cashier | `cashier@stocksmart.test` | `Cashier@123` |

Options: `npm run seed -- --reset` wipes existing data first (required if the database is not
empty), `--days 180` changes the history length, and `--seed 42` gives a different but
reproducible dataset.

## Scripts

Run from the repository root:

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `npm run dev`       | Start API and web in watch mode                |
| `npm run build`     | Production build of all packages               |
| `npm test`          | Run all unit and API tests                     |
| `npm run lint`      | Lint all code                                  |
| `npm run typecheck` | Type-check all packages                        |
| `npm run format`    | Format all files with Prettier                 |
| `npm run check`     | Format check + lint + typecheck + test (as CI) |
| `npm run seed`      | Load demo data (see above)                     |

### Tests

API tests run against a real, in-memory MongoDB replica set
([mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server)), so unique indexes and
transactions are tested for real. The first run downloads a MongoDB binary (about 100 MB, cached
afterwards). Without internet access, point it at an installed `mongod` instead:
`MONGOMS_SYSTEM_BINARY=/path/to/mongod npm test`.

## Environment variables (API)

| Variable                   | Default                                                                    | Description                                         |
| -------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| `NODE_ENV`                 | `development`                                                              | `development`, `test` or `production`               |
| `PORT`                     | `4000`                                                                     | HTTP port                                           |
| `MONGODB_URI`              | `mongodb://localhost:27017/inventory?replicaSet=rs0&directConnection=true` | MongoDB connection string                           |
| `CORS_ORIGIN`              | `http://localhost:5173`                                                    | Allowed browser origins, comma-separated            |
| `LOG_LEVEL`                | `info`                                                                     | Pino log level                                      |
| `JWT_ACCESS_SECRET`        | dev-only value                                                             | **Required in production** (`openssl rand -hex 32`) |
| `ACCESS_TOKEN_TTL_SECONDS` | `900`                                                                      | Access token lifetime                               |
| `REFRESH_TOKEN_TTL_DAYS`   | `7`                                                                        | How long a sign-in lasts without activity           |
| `COOKIE_SECURE`            | `true` in production                                                       | Refresh cookie over HTTPS only                      |
| `COOKIE_SAME_SITE`         | `strict`                                                                   | `none` only if web and API are on different sites   |

## API

| Area                   | Paths                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| Health                 | `GET /api/health`                                                        |
| Sign-in and sessions   | `/api/auth/login`, `refresh`, `logout`, `me`, `change-password`          |
| Staff accounts (admin) | `/api/users`                                                             |
| Catalogue              | `/api/products`, `/api/categories`, `/api/suppliers`                     |
| Inventory              | `/api/inventory/movements`, `summary`, `adjustments`                     |
| Purchasing             | `/api/purchase-orders` (create, place, receive, cancel), `/api/settings` |

Every endpoint, its permission and its fields are listed in [docs/API.md](docs/API.md). Errors
always have the shape `{ "error": { "code": "...", "message": "..." } }`.

## Documentation

- [Project plan & roadmap](docs/PLAN.md)
- [Database design & ER diagram](docs/DATABASE.md)
- [Authentication, roles & security](docs/AUTH.md)
- [REST API reference](docs/API.md)
- [Project report (VTU format, Word + PDF)](docs/report/README.md)
