# Spin Hobby server

NestJS API for spinhobby.com. It is the **only backend**: the storefront, checkout and staff
admin in [`SpinHobby/spin-hobby`](https://github.com/SpinHobby/spin-hobby) talk to it and
nothing else. Sign-in, catalog filtering, category trees, checkout, payments, Square sync,
the cashier tool and all admin actions run here.

```
browser ──► spin-hobby API (this repo) ──► Supabase Postgres · Supabase Auth · Supabase Storage
                                        └─► Square · PayPal · Resend · Claude
```

The Supabase edge functions that used to do this are retired (they and the old Express server
are in git history). Supabase is still the database, identity provider and file storage;
`supabase/migrations` is the schema.

| | |
|---|---|
| Framework | NestJS 12 (ES modules), Node 22+ |
| Database | Supabase Postgres, schema in [`supabase/migrations`](supabase/migrations) |
| Sign-in | `POST /auth/login` etc., backed by Supabase Auth |
| Payments | PayPal or Square (switchable in Admin → Settings) |
| Catalog | Square sync + hand-entered products, shop category tree |
| Email | Resend (restock alerts, shipping notices) |
| Cashier AI | Claude (`claude-opus-5`) with a monthly budget cap |

## Local development (no Docker, no Supabase account)

```sh
npm install
npm run dev:local     # API on http://localhost:8080 with a seeded in-process Postgres
```

Sign in as `owner@spinhobby.test` / `spinhobby` (or `staff@spinhobby.test`). Then run the
frontend with `VITE_API_URL=http://localhost:8080 npm run dev` in the spin-hobby repo.

To run against a real Supabase project instead: `cp .env.example .env`, fill it in, `npm run start:dev`.

## Run locally

```sh
cp .env.example .env         # fill in DATABASE_URL + SUPABASE_URL at minimum
npm install
npm run start:dev            # http://localhost:8080/health
```

Apply the schema to a new Supabase project with `supabase db push`. See
[`AUTH_SETUP.md`](AUTH_SETUP.md) for Google sign-in and making yourself an owner
(`OWNER_EMAILS`).

## Tests

```sh
npm test            # unit tests
npm run test:e2e    # every HTTP route against a real Postgres (PGlite) with the real migrations
```

The e2e suite needs no network or Docker: PayPal, Square, Resend and Claude calls are
intercepted, and sign-ins use locally signed tokens.

## Deploy (Render)

`render.yaml` is a Render Blueprint: **New → Blueprint → this repo**. It builds the Dockerfile,
health-checks `/health`, auto-deploys `main`, and prompts for the secrets
(`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, payment/email keys). Then point the storefront's
`VITE_API_URL` at the Render URL. Any other container host works too:

```sh
docker build -t spin-hobby-api .
docker run -p 8080:8080 --env-file .env spin-hobby-api
```

Then set `SQUARE_WEBHOOK_URL` to `https://<your-host>/webhooks/square` in both the
Square dashboard and the environment.

## Staging

A separate staging stack (branch `staging`, its own Render service and Supabase project, sandbox
payments) for testing before production. See [`STAGING.md`](STAGING.md).

## How stock works

- Square-sourced products: Square owns the count (sync + inventory webhook). Hand-entered products: this server owns it
  and takes sold units off when an order is paid.
- A shopper starting checkout holds those units for `ORDER_HOLD_MINUTES` (default 30). Availability everywhere is
  `stock − holds`, so two people can't buy the last one; abandoned checkouts are cancelled by a background job and a payment
  that arrives for an expired checkout is refused (`ORDER_EXPIRED`) before any charge.
- A Square sale that Square hasn't reported back yet still counts until the next sync/webhook passes it.
- The catalog sync hides Square-sourced products deleted in Square (never hand-entered ones), unless it would hide more than
  `SQUARE_SYNC_RETIRE_MAX_RATIO` of them. Limit: PayPal sales of Square-sourced items never reach Square's count.

## Routes

Access: **public** · **user** (signed in) · **staff** (staff or owner) · **owner**.

| Area | Routes |
|---|---|
| Sign-in (public) | `GET /auth/providers` · `POST /auth/login` `/auth/refresh` · `GET /auth/oauth-url` |
| Catalog (public) | `GET /products` (filters: `categoryId`, `group`, `ids`, `q`, `status`, `min`/`max`, `sort`) `/products/facets` `/categories` `/products/preorders` `/products/ranking` `/products/new-in-stock` `/homepage` `/square/catalog[/:id]` `/square/inventory` `/square/config` `/square/display-categories` |
| Checkout (public) | `GET /checkout/config` · `POST /cart/quote` `/checkout/intent` `/paypal/capture` `/square/payments` · `GET /orders/lookup` |
| Account (user) | `GET /auth/me` · `POST /auth/logout` · `GET/POST /wishlist` · `DELETE /wishlist/:id` · `GET /orders[/:id]` · `POST /alerts` (public) |
| Admin (staff) | `GET /admin/dashboard` · `GET /admin/products` · `PATCH /admin/products/:id` · `POST /admin/products/:id/notify-restock` · `GET /admin/orders[/:id]` · `POST /admin/orders/:id/ship` · `GET /admin/orders/:id/packing-slip` · slides `GET/POST/PUT/DELETE /admin/homepage/slides[/:id\|/reorder]` · events `GET/POST/PUT/DELETE /admin/events[/:id]` · `GET /admin/square/readiness` · `GET /admin/settings` |
| Admin (owner) | `PUT /admin/settings` · `GET/PUT /admin/tax-rates` · `POST /admin/orders/:id/refund` · `POST /admin/square/sync` |
| Cashier (staff) | `POST /cashier/identify` `/cashier/record` · `GET /cashier/search` · `GET/PUT /cashier/item/:id` |
| Ops (owner) | `GET /ops/ai-usage` · `PUT /ops/ai-usage/:tool` · `GET /ops/database` |
| Integrations | `POST /webhooks/square` `/webhooks/paypal` · `POST /square-sync` (owner or `x-square-sync-secret`) · `GET /health` |

Errors are always `{ "success": false, "error": "…", "code"?: "…" }`.

## Layout

```
src/
  auth/          Supabase token verification, access guard, OWNER_EMAILS bootstrap
  catalog/       storefront product queries (storefront_products view)
  checkout/      server-side quote (price, tax, stock minus holds) and the checkout routes
  orders/        order lifecycle: create + hold stock, mark paid, expire abandoned checkouts, receipt email
  payments/      PayPal and Square clients; PaymentsService runs order creation and capture
  admin/         dashboard, products, orders, settings, slides, events
  square-sync/   Square catalog + inventory mirror
  cashier/       photo → Claude → Square item tool, AI budget
  webhooks/      Square (HMAC) and PayPal webhooks
  db/            pg pool + transactions
supabase/        database migrations + Auth config
scripts/         dev-local.mjs (seeded local Postgres + API), seed-staging.mjs
src/sample/      the sample catalog (products, pictures, orders) used by staging and local development
test/            e2e suite + PGlite harness
```
