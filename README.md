# Spin Hobby server

The API behind [spinhobby.com](https://spinhobby.com): the shop, checkout, payments, the staff
admin and the in-store cashier tool all talk to this one server. It is written in
[NestJS](https://nestjs.com) (TypeScript). The website lives in a separate repo,
[`SpinHobby/spin-hobby`](https://github.com/SpinHobby/spin-hobby).

```
browser ──► this API ──► Postgres (Supabase)   products, orders, accounts
                    ├──► Supabase Auth         sign-in
                    ├──► Square                catalog, stock, card payments
                    ├──► PayPal                payments
                    ├──► Resend                emails
                    └──► Claude                the cashier's photo identification
```

**New here? Read [`docs/INTERNS.md`](docs/INTERNS.md) first.** It is a friendly, step-by-step
guide for your first day and first week.

## Run it on your computer (5 minutes)

You need [Node.js 22 or newer](https://nodejs.org). No Docker, no accounts, no passwords.

```sh
npm install
npm run dev:local
```

That builds the server, starts a throw-away database filled with sample products and orders, and
starts the API:

| | |
|---|---|
| API | http://localhost:8080 |
| Interactive API docs | http://localhost:8080/docs (try any endpoint from the browser) |
| Health check | http://localhost:8080/health |
| Owner login | `owner@spinhobby.test` / `spinhobby` |
| Staff login | `staff@spinhobby.test` / `spinhobby` |

The database is kept in memory, so every start begins from the same clean sample data.
To see the website too, start the frontend repo with `VITE_API_URL=http://localhost:8080 npm run dev`.

Optional: put a Square **sandbox** token in `.env` (`SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`) and
`dev:local` also pulls those Square items in. Every setting is explained in
[`.env.example`](.env.example).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev:local` | Run everything locally with sample data (use this most of the time) |
| `npm run typecheck` | Check the TypeScript compiles |
| `npm run lint` | Find likely bugs and rule breaks (`npm run lint:fix` fixes the easy ones) |
| `npm run format` | Tidy the formatting (`npm run format:check` only checks) |
| `npm test` | Fast unit tests (about 1 second) |
| `npm run test:e2e` | Every route against a real in-memory Postgres (about 30 seconds) |
| `npm run build` | Compile to `dist/` |

Before you open a pull request, all of these must pass:

```sh
npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e
```

## Where to look

| I want to… | Read |
|---|---|
| Get started as an intern | [`docs/INTERNS.md`](docs/INTERNS.md) |
| Understand how the code is organised | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Add a new endpoint, step by step | [`docs/ADD-AN-ENDPOINT.md`](docs/ADD-AN-ENDPOINT.md) |
| Know how to branch, commit and open a PR | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| See every setting the server reads | [`.env.example`](.env.example) |
| Set up or use the staging site | [`STAGING.md`](STAGING.md) |
| Set up sign-in (Google) or make someone an owner | [`AUTH_SETUP.md`](AUTH_SETUP.md) |
| See every endpoint | `/docs` when running locally, or `test/e2e/routes.e2e-spec.ts` for the full list |

## What is where (one-minute tour)

```
src/
  modules/        one folder per feature: catalog, checkout, orders, admin, cashier, ...
  integrations/   the code that talks to outside services: square, paypal, supabase, email, ...
  common/         small shared helpers: errors, guards, validation
  config/         every setting the server reads (the only place that touches environment variables)
  database/       database access, typed table rows, and the migration runner
supabase/migrations/   the database schema (SQL files, applied in order)
test/             end-to-end tests (test/e2e) and their helpers (test/support)
scripts/          dev-local.mjs and the staging seed script
```

## Deploying

You don't deploy by hand. Pushing to a branch deploys it on Render:

| Branch | Environment | URL |
|---|---|---|
| `staging` | staging (sandbox payments, sample data) | https://spin-hobby-server-staging.onrender.com |
| `main` | **production** (real customers, real money) | https://spin-hobby-server.onrender.com |

New work goes to `staging` first, is tested there, and only then merged to `main`. Details in
[`STAGING.md`](STAGING.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md). `render.yaml` and
`render.staging.yaml` describe the two Render services, and the `Dockerfile` builds the image
(it runs `node dist/main.js`; any container host works).

## Good to know

- **Money is always whole cents** (`price_cents: 3900` is $39.00). Never use decimals for money.
- **Square owns the product catalog and stock** for items synced from Square. Staff can also
  create hand-entered products in the admin; those live only in our database.
- **Stock is held during checkout.** A shopper who starts paying holds those units for
  `ORDER_HOLD_MINUTES` (30 by default) so two people can't buy the last one. Details in
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#stock-and-holds).
- **Errors always look the same:** `{ "success": false, "error": "message" }`.
- **The database schema only changes through a new migration file.** Never edit an old one.
