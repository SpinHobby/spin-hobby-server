# How the server is organised

Read this once and you'll know where everything lives. It takes about 15 minutes.
If you're brand new, start with [`INTERNS.md`](INTERNS.md).

## The big picture

```
                    ┌──────────────────────────── this server (NestJS) ─────────────────────────────┐
 website (browser)  │                                                                               │
 admin pages        │  Controller ──► Service ──► Db ──────────────────────────► Postgres (Supabase)│
 cashier tool ─────►│  (the URL)      (the rules)  (SQL)                                            │
                    │                    │                                                          │
                    │                    └──► Integrations ──► Square · PayPal · Supabase Auth ·    │
                    │                         (outside world)    Resend (email) · Claude · Storage  │
                    └───────────────────────────────────────────────────────────────────────────────┘
```

The server has no screens of its own. It answers requests with JSON, and the website
(`spin-hobby` repo) turns that into pages.

## Folder map

```
src/
  main.ts            starts the server
  app.module.ts      lists every feature module (read this to see what exists)
  app.setup.ts       settings shared by the server and the tests: CORS, security headers, validation
  app.docs.ts        the /docs page
  load-env.ts        loads .env at start-up

  modules/           FEATURES: one folder per part of the shop
  integrations/      OUTSIDE SYSTEMS: the only code that talks to Square, PayPal, Supabase, ...
  common/            small shared helpers (errors, guards, validation)
  config/            SETTINGS: the only code that reads environment variables
  database/          the Db class, typed table rows, and the migration runner

supabase/migrations/ the database schema, as numbered SQL files
test/e2e/            tests that call real routes against a real (in-memory) Postgres
test/support/        helpers for those tests
scripts/             dev-local.mjs (npm run dev:local) and the staging seed script
```

### The feature modules (`src/modules`)

| Folder | What it does |
|---|---|
| `catalog` | The public shop: product lists, filters, homepage content, categories |
| `checkout` | The shopper's checkout routes: config, price a cart, start a payment |
| `orders` | An order's life: price it (`QuoteService`; the pricing rules are plain functions in `quote-math.ts`), create it, hold stock, mark paid, expire it |
| `payments` | Charges the card through PayPal or Square and tells `orders` what happened |
| `webhooks` | Messages Square and PayPal send *to us* (payment finished, stock changed) |
| `square-sync` | Copies the Square catalog and stock into our database |
| `auth` | Who is signed in: login, sign-up, tokens, roles, the access guard |
| `account` | A signed-in customer's wishlist and restock alerts |
| `store` | Shop-wide settings: shipping rates, free-shipping threshold, maintenance mode |
| `admin` | Everything staff do: dashboard, products, orders, homepage banners, events, categories, settings |
| `cashier` | The in-person tool: photo → Claude → new Square item |
| `ops` | Owner-only: AI spending limits, database size |
| `health` | `/health` checks for the host and for debugging |
| `sample` | Sample products for staging and local runs (never loaded in production) |

### Inside one module

Every feature module is laid out the same way:

```
modules/ops/
  ops.module.ts          the table of contents: which controllers and services this module has
  ops.controller.ts      the routes (URLs). Thin.
  ops.service.ts         the real work: rules and SQL
  dto/ai-budget.dto.ts   what the PUT /ops/ai-usage/:tool request may contain
```

Bigger modules (like `admin`) have one sub-folder per screen with the same shape inside.

## What happens to a request

Take `POST /admin/orders/42/ship` as an example:

1. **`requestContext`** (`common/middleware`) gives the request an id and logs it when done.
2. **Origin check and CORS** (`app.setup.ts`): browsers on unknown websites are refused.
3. **`RateLimitGuard`** (`common/guards`): too many requests from one IP → `429`.
4. **`AccessGuard`** (`modules/auth/access.ts`): reads the `Authorization` header, loads the user,
   and compares their role with the route's `@Access('staff')`. No token → `401`, wrong role → `403`.
5. **`AppValidationPipe`** (`common/validation`): checks the body against the route's DTO class.
   Wrong input → `400` with a readable message, before any of your code runs.
6. **The controller method** calls one service method.
7. **The service** applies the rules and runs SQL through `Db`.
8. **The reply** is JSON. Errors thrown anywhere go through **`JsonErrorFilter`**, which always
   answers `{ "success": false, "error": "…" }`.

## The six rules (and who checks them)

| # | Rule | Checked by |
|---|---|---|
| 1 | **Controllers only route.** A controller method validates nothing itself and calls one service method. No SQL, no business rules. | Code review |
| 2 | **Services own the rules and the SQL.** SQL stays next to the logic that needs it. | Code review |
| 3 | **Every request body or query has a DTO class** with a doc comment on each field. | Code review, `/docs` |
| 4 | **Only `integrations/` talks to outside systems** (Square, PayPal, Supabase, email, Claude). | Code review |
| 5 | **Only `config/` reads environment variables.** Everyone else imports a named function like `squareLocationId()`. | **Lint** |
| 6 | **Throw `AppError` for problems a user should see.** Anything else becomes a logged `500` with a request id. | Convention |

Also enforced by lint: no `any` (type database rows in `database/rows.ts`; outside payloads use
`ExternalJson`), no forgotten `await`, and no `console.log` (use Nest's `Logger`).

## Key building blocks

### Access levels

Put `@Access('…')` on a controller (applies to all its routes) or on a single route:

| Level | Who may call it |
|---|---|
| `public` (default) | Anyone. If they're signed in, we still know who they are. |
| `user` | Any signed-in account |
| `staff` | Staff or owner |
| `owner` | Owner only |

Get the signed-in person in a controller with `@CurrentUser() user: AppUser`.

### DTOs and validation

A DTO is a class listing what a request may contain. Decorators say what's valid and carry the
exact error message:

```ts
export class ShipOrderDto {
  /** The carrier's tracking number; it is emailed to the customer. */
  @Text('trackingNumber', 200)   // required text, trimmed, max 200 characters
  trackingNumber!: string;

  /** e.g. `Canada Post`. */
  @OptionalText(100)             // optional; blank becomes null
  carrier: string | null = null;
}
```

The building blocks (`@Text`, `@OptionalText`, `@PositiveInt`, `@Flag`, `@EmailAddress`, or `@Rule(fn)` for
anything custom) live in `src/common/validation/decorators.ts`; the rules behind them are in `rules.ts`.
Fields the DTO doesn't list are ignored. The doc comments feed the `/docs` page.

### Errors

```ts
throw new AppError('Only paid orders can be shipped.');         // 400 (default)
throw new AppError('Order not found.', 404);
throw new AppError('Checkout expired.', 409, 'ORDER_EXPIRED');  // optional machine-readable code
throw notFound('Order');                                         // shortcut for "Order not found." (404)
```

The message is shown to the user as-is, so write it for a shopper or staff member, never for developers.

### The database

- **`Db`** (`database/db.service.ts`) is our thin wrapper over the Postgres driver:
  `many(sql, params)` returns rows, `one(sql, params)` returns one row or `null`, `exec(sql, params)`
  runs a statement, `transaction(fn)` makes several statements succeed or fail together.
  Always pass values as parameters (`$1`, `$2`, …), never paste them into the SQL text.
- **`database/rows.ts`** has a TypeScript type for each main table. Use them as the type argument:
  ```ts
  const order = await this.db.one<Pick<OrderRow, 'id' | 'status'>>(
    'select id, status from public.orders where id = $1', [id]);
  ```
  What the driver returns: bigint and numeric columns are numbers, timestamps are ISO text, jsonb is
  already an object.
- **Migrations** live in `supabase/migrations`, named `YYYYMMDDHHMMSS_what_it_does.sql`. The server
  applies new ones when it starts (`MigrationService`). To change the schema, **add a new file**.
  Never edit one that already exists.

### Settings (environment variables)

All settings are read in `src/config/*.config.ts` (`square.config.ts`, `supabase.config.ts`, …),
each as a small function with a comment saying what it's for and its default. To add a setting:
add a function there, add a line to `.env.example`, and use the function. A test fails if a setting is
missing from `.env.example`, and lint fails if you read `process.env` anywhere else. On start the server
also warns about badly formatted values (`config/validate-env.ts`).

### Integrations (`src/integrations`)

| Folder | Talks to |
|---|---|
| `square` | Square, through two clients: `SquareHttpClient` (plain `fetch`: payments, orders, refunds, catalog sync) and `SquareCatalogClient` (the official SDK: the cashier tool's searches, item edits and stock counts) |
| `paypal` | PayPal: create and capture orders, refunds, webhook verification |
| `supabase` | Supabase Auth: sign in, sign up, password reset |
| `storage` | Photo uploads (Supabase Storage, or the local disk in development) |
| `email` | Resend: confirmations, shipping notices, restock alerts |
| `sentry` | Optional error reporting |

Keep these dumb: they translate between our code and the outside service. Business decisions
("is this refundable?") belong in a module's service.

## Following the money: checkout

```
1  POST /cart/quote        price the cart: item prices, shipping, tax, and warnings (out of stock, limits…)
2  POST /checkout/intent   re-price on the server, create a pending order, HOLD the stock,
                           and start the payment with PayPal or Square
3  (shopper pays in the PayPal or Square card form on the website)
4a POST /paypal/capture    or
4b POST /square/payments   charge it, then OrdersService.markPaid(): order becomes `paid`
                           (or `preorder_reserved`), a confirmation email is sent
5  webhooks                Square/PayPal also tell us; we ignore duplicates
```

The server never trusts prices from the browser: step 2 always recalculates from the database.

### Where a product lives: Square or our database

Every product is one row in `catalog_products`, and `source` says where it is managed: `square` (synced from Square) or `manual` (added in the admin, id starts with `manual-`). The admin list shows this, where its photos are kept (`photoSource`: Square, our storage, elsewhere, none) and whether it is on the website.

- **Show / hide** (`PUT /admin/products/:id/visibility`): sets `is_visible`. For a Square item it also adds or removes the "not for the website" category *in Square* (`SquareCatalogClient.setItemHidden`), so Square and the website agree. The product is never deleted.
  - **What Square says is hidden** is decided in one place, `integrations/square/visibility.ts`, and used by the sync, the webhook refresh and the toggle: the item carries our "not for the website" category, **or** Square itself says so (online visibility "Hidden", or the item is not sold at our location). Our toggle can only write the category, so showing an item that Square itself hides returns a clear 409 ("show it in the Square Dashboard") instead of silently doing nothing. The sync log line reports how many items are hidden.
- **Move to Square** (`POST /admin/products/:id/transfer-to-square`, owner only; `ProductTransferService`): creates the item in Square, copies the photos and stock, carries over what only we hold (metadata, wishlists, restock alerts), marks the old row as replaced (`replaced_by` points at the new id), then deletes its photo files from our storage and finally the old row itself, so the product exists once. Past orders keep their own copy of the name, price and photo, so they are unaffected. Before anything is deleted here it **checks the copy** (as our database sees it after a sync: name, price, stock, photo count, hidden state). If the check or any step fails, it **reverts**: the copy is deleted from Square again (`SquareCatalogClient.deleteItem`) and the product stays exactly as it was. If Square will not delete the copy, `replaced_by` stays on the old row so the next try reuses it instead of making a second one. Photos are only deleted after Square has accepted all of them and the check passed.
- **Staying up to date:** the app updates its own rows right after each action, and Square's `catalog.version.updated` webhook asks `SquareSyncService.requestSync()` for a (debounced) re-sync, so edits made in the Square dashboard show up within seconds. The 15-minute sync is the safety net. After each sync, `PhotoCleanupService` finishes any move that stopped before cleanup (photos, then the old row).

### Stock and holds

- For items synced from Square, **Square owns the stock count** (we copy it in with the sync and
  the inventory webhook). For hand-entered products, **we own it** and take sold units off when
  an order is paid.
- When a shopper starts checkout, their items are **held** for `ORDER_HOLD_MINUTES` (30). Available
  stock everywhere is `stock − holds`, so two people can't buy the last one.
- A background job cancels unpaid orders after the hold ends. A payment arriving for an expired
  order is refused (`ORDER_EXPIRED`) *before* any card is charged.
- A sale that Square hasn't reported back yet still counts until the next sync or webhook passes it.
- The cashier tool keeps in-person-only items (convention one-offs) off the website by putting them in a special Square category (`CASHIER_CATEGORY_ID`). The sync still copies them, but marks them not visible, so the shop never shows them and the admin lists them as "hidden".
- The sync hides products deleted in Square (never hand-entered ones), unless that would hide more
  than `SQUARE_SYNC_RETIRE_MAX_RATIO` of them: that looks like a mistake, so it's skipped.

## Testing

| Kind | Where | Speed | Use it for |
|---|---|---|---|
| Unit tests | `src/**/*.spec.ts`, next to the code | about 1 s total | Pure logic: validation rules, formatting, small helpers |
| End-to-end tests | `test/e2e/*.e2e-spec.ts` | about 30 s total | Whole routes: send a real HTTP request, check the reply and the database |

The e2e tests start the real app on an in-memory Postgres with the real migrations. Payment, email,
Square and Claude calls are faked, so tests need no network and no accounts. `test/support/shop.ts`
gives you a ready shop (`startShop()`): sample products and three signed-in users (`owner`, `staff`,
`shopper`). Look at any file in `test/e2e/` to copy the pattern.

One special test, `test/e2e/routes.e2e-spec.ts`, lists **every route** with its access level. If you add,
remove or change a route on purpose, update that list in the same commit; if it fails and you didn't
mean to change a route, you've found a mistake.

## Where does X go? (cheat sheet)

| I need to… | Put it in… |
|---|---|
| Add a URL | The module's `*.controller.ts` (and a DTO if it takes input) |
| Add a business rule or SQL | The module's `*.service.ts` |
| Talk to a new outside service | A new folder in `src/integrations/` |
| Add a setting | `src/config/` + `.env.example` |
| Change the database | A **new** file in `supabase/migrations/`, then update `database/rows.ts` |
| Share a tiny helper between modules | `src/common/` (only if two modules really need it) |
| Add a whole new feature | A new folder in `src/modules/` with a `*.module.ts`, then list it in `app.module.ts` |
