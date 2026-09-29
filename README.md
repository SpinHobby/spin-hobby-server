# Spin Hobby server

NestJS API for spinhobby.com — the storefront, checkout and staff admin in
[`SpinHobby/spin-hobby`](https://github.com/SpinHobby/spin-hobby) talk to it.

It serves **the same routes and JSON** as the Supabase `store-api` edge function in
[`supabase/functions`](supabase/functions), so the frontend can use either one by
changing a single variable:

```
VITE_STORE_API_BASE=https://api.spinhobby.com                               # this server
VITE_STORE_API_BASE=https://<ref>.supabase.co/functions/v1/store-api        # edge function
```

| | |
|---|---|
| Framework | NestJS 12 (ES modules), Node 22+ |
| Database | Supabase Postgres, schema in [`supabase/migrations`](supabase/migrations) |
| Sign-in | Supabase Auth access tokens (verified with the project's signing keys) |
| Payments | PayPal or Square (switchable in Admin → Settings) |
| Catalog | Mirrored from Square (`POST /admin/square/sync`, webhook, or on a timer) |
| Email | Resend (restock alerts, shipping notices) |
| Cashier AI | Claude (`claude-opus-5`) with a monthly budget cap |

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

## Deploy

Any Node or container host works (Render, Railway, Fly, Cloud Run…):

```sh
docker build -t spin-hobby-api .
docker run -p 8080:8080 --env-file .env spin-hobby-api
```

Then set `SQUARE_WEBHOOK_URL` to `https://<your-host>/webhooks/square` in both the
Square dashboard and the environment, and point the storefront's
`VITE_STORE_API_BASE` at the host.

## Routes

Access: **public** · **user** (signed in) · **staff** (staff or owner) · **owner**.

| Area | Routes |
|---|---|
| Catalog (public) | `GET /products` `/products/facets` `/products/preorders` `/products/ranking` `/products/new-in-stock` `/homepage` `/square/catalog[/:id]` `/square/inventory` `/square/config` `/square/display-categories` |
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
  checkout/      server-side quote, order intent, PayPal/Square capture
  admin/         dashboard, products, orders, settings, slides, events
  square-sync/   Square catalog + inventory mirror
  cashier/       photo → Claude → Square item tool, AI budget
  webhooks/      Square (HMAC) and PayPal webhooks
  db/            pg pool + transactions
supabase/        migrations + the original edge functions
legacy/          the previous Express server, kept for reference
test/            e2e suite + PGlite harness
```
