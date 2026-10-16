# StockSmart: Digital Inventory & Sales Management System

A web application for retail stores to manage products, stock, purchases and sales, with
GST-compliant invoicing, AI demand forecasting and an AI assistant.

Built with the **MERN** stack in TypeScript: MongoDB, Express, React and Node.js.

> **Status:** Step 1 of 10 (project scaffolding) is complete. See the roadmap in
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
│   │   │   ├── middleware/  # error handling, auth (later)
│   │   │   ├── routes/      # route definitions
│   │   │   └── utils/       # logger, errors
│   │   └── test/
│   └── web/            # React frontend
│       ├── src/
│       │   ├── components/
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
```

Open **http://localhost:8080**. The API is also available at http://localhost:4000/api/health.

### Option B: local development (hot reload)

Requires **Node.js 22+** and Docker (for MongoDB only).

```bash
npm install                       # install all workspaces
cp apps/api/.env.example apps/api/.env
docker compose up -d mongo        # start MongoDB as a replica set
npm run dev                       # API on :4000, web on :5173
```

Open **http://localhost:5173**. The Vite dev server forwards `/api` requests to the API.

> Using MongoDB Atlas instead of Docker? Put your Atlas connection string in `MONGODB_URI` in
> `apps/api/.env`. Atlas clusters are replica sets, so transactions work.

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

## Environment variables (API)

| Variable      | Default                                                                    | Description                              |
| ------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| `NODE_ENV`    | `development`                                                              | `development`, `test` or `production`    |
| `PORT`        | `4000`                                                                     | HTTP port                                |
| `MONGODB_URI` | `mongodb://localhost:27017/inventory?replicaSet=rs0&directConnection=true` | MongoDB connection string                |
| `CORS_ORIGIN` | `http://localhost:5173`                                                    | Allowed browser origins, comma-separated |
| `LOG_LEVEL`   | `info`                                                                     | Pino log level                           |

## API

| Method | Path          | Description                                            |
| ------ | ------------- | ------------------------------------------------------ |
| GET    | `/api/health` | Service and database status (`200` ok, `503` degraded) |

Errors always have the shape `{ "error": { "code": "...", "message": "..." } }`.

## Documentation

- [Project plan & roadmap](docs/PLAN.md)
