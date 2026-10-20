# Welcome to the Spin Hobby server

This guide is for your first day and your first week. You don't need to know NestJS yet. If a
word is new, check the [glossary](#glossary) at the bottom.

## What this project is

Spin Hobby is a small shop that sells anime figures, plushies and merch, in person at
conventions and online at spinhobby.com. This repo is the **server** (also called the API or
backend). It is the program that:

- stores and serves the products, orders and accounts,
- takes payments (PayPal or Square),
- keeps the product catalog and stock in sync with Square (the shop's point-of-sale system),
- powers the staff **admin** pages and the **cashier** tool used at conventions.

The website you see in the browser is a different repo (`spin-hobby`). It does nothing on its
own: every product, price and order comes from this server.

## Day 1 checklist

1. **Install Node.js 22 or newer** (`node --version` should say `v22` or higher).
2. **Get the code** and open a terminal in the `spin-hobby-server` folder.
3. **Run it:**
   ```sh
   npm install
   cp .env.intern .env
   npm run dev:local
   ```
   `.env.intern` holds no keys and is safe to share. It is all you need: see
   [Your own keys (only if you need them)](#your-own-keys-only-if-you-need-them).
   Wait for a line saying the API is listening. The first start takes a minute.
4. **Open the interactive API docs:** http://localhost:8080/docs
5. **Try a request from the docs page.**
   - Open `GET /products` → *Try it out* → *Execute*. You should see sample products.
   - Sign in: open `POST /auth/login` → *Try it out* and send
     `{ "email": "owner@spinhobby.test", "password": "spinhobby" }`. Copy the `accessToken`
     from the answer.
   - Click **Authorize** at the top of the page, paste the token, and try `GET /admin/dashboard`.
     It works because you are signed in as the owner. Try it without the token and you get a 401.
6. **Run the tests** (in a second terminal, leave `dev:local` running):
   ```sh
   npm test
   npm run test:e2e
   ```
   Everything should be green. If something is red on a fresh checkout, tell us: that is a bug
   in the project, not in you.
7. **Read [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)** (about 15 minutes). It's the map of the code.

8. **Set up your editor (optional but recommended).** In VS Code, open the `spin-hobby-server` folder and click
   "Install" when it suggests the ESLint and Prettier extensions. After that your files format themselves on save.
   A small check also runs when you `git commit` and tells you if something needs fixing.

Tips for `dev:local`:

- When you save a file, the API restarts by itself within a few seconds.
- Test data lives in memory. Stop the command and start it again to get clean sample data.
- You can also run the website against it: in the `spin-hobby` repo run
  `VITE_API_URL=http://localhost:8080 npm run dev`.

## Your own keys (only if you need them)

You never need the shop's real keys, and nobody will send you them. With just `.env.intern` the whole shop runs on
your computer:

| What | Without any keys |
| --- | --- |
| Database | A built-in test database, filled with sample products and orders, reset at every start |
| Signing in | `owner@spinhobby.test` / `spinhobby` and `staff@spinhobby.test` / `spinhobby` |
| Checkout | **Test payment**: a "Place order (test, no money)" button. The order is completed like a paid one (stock goes down, it appears in the admin) and no card is asked for |
| Adding products | Saved in our database only ("Square isn't connected here") |
| Gleamshelf drafts | "Add to the shop" saves the product in our database only, photos included |
| eBay, email, the paid AI tool | Shown as off or "not set up". Nothing else breaks |

Each part below turns on one more thing. Make the keys **yourself, in your own free test account**, and paste them
into your `.env` (never into code, a commit or a chat). Leave a part empty and that feature stays off.

- **Square sandbox** (a test Square shop of your own): syncs its catalog in, card checkout with Square's test cards
  (`4111 1111 1111 1111`), and creating products in Square. Sign up free at
  [developer.squareup.com](https://developer.squareup.com) → *Create an application* → switch to **Sandbox** at the
  top → copy the access token and application id (*Credentials*) and a location id (*Locations*) into
  `SQUARE_ACCESS_TOKEN`, `SQUARE_APPLICATION_ID` and `SQUARE_LOCATION_ID`.
- **PayPal sandbox** (checkout with a PayPal test buyer): [developer.paypal.com](https://developer.paypal.com) →
  *Apps & Credentials* → **Sandbox** → *Create App* → `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`.
- **eBay sandbox** (connect a test seller and list from the admin): [developer.ebay.com](https://developer.ebay.com)
  → a **Sandbox** keyset, then follow [`docs/EBAY.md`](EBAY.md). For `EBAY_TOKEN_KEY` run `openssl rand -base64 32`.
- **Email** (order confirmations): this sends **real** email. Only with your own [Resend](https://resend.com) account,
  and only order with your own address.
- **The paid AI tool** (the cashier's photo-to-listing): every photo costs real money. Only with a key the shop owner
  made for you, with its own spending limit. Locally it stops by itself at $5 a month.

You can't break the real shop from your computer: `npm run dev:local` never uses a real database, and it leaves out
live Square, live PayPal and production eBay keys even if they end up in your `.env` (it tells you when it starts).
Test payments only exist there: the real shop never offers them.

## The mental model (read this twice)

Every request follows the same path, and every feature is built the same way:

```
HTTP request
   │
   ▼
Controller   "which URL is this, who may call it?"        only routing, no logic
   │  checks the body with a DTO (a class that lists the allowed fields)
   ▼
Service      "what does the shop do?"                      business rules and SQL live here
   │
   ▼
Db           runs SQL against Postgres                      returns plain rows
```

- A **controller** (`*.controller.ts`) is a list of URLs. Each method is two or three lines.
- A **DTO** (`dto/*.ts`) describes what a request may contain, and the error shown when it's wrong.
- A **service** (`*.service.ts`) does the real work. This is where you'll write most code.
- A **module** (`*.module.ts`) is a folder's table of contents: its controllers and services.

If you know this, you can open any folder in `src/modules` and find your way around, because
they all look the same.

## How to find things

| You want to find… | Look here |
|---|---|
| The code behind `POST /checkout/intent` | Search the repo for `checkout/intent`; the controller points to a service |
| What an endpoint accepts | The `dto/` folder next to its controller (or `/docs`) |
| A database table's columns | `supabase/migrations/*.sql`, or `src/database/rows.ts` for the common ones |
| What a setting does | `.env.example`, then `src/config/*.config.ts` |
| Where a message shown to users comes from | Search the exact text in `src/` |
| Why a test exists | Open it: tests are written as plain sentences (`it('refuses…')`) |

Tip: search for a word from the error message. Almost everything a user can see is spelled out
in the source.

## Your first week

Pick these in order. Each one is small and teaches one idea. Ask for a review before merging.

1. **Read a feature end to end (day 1–2).** Take `GET /ops/database`. Find the controller
   (`src/modules/ops/ops.controller.ts`), the service it calls, and the SQL. Explain it back to
   a teammate in your own words.
2. **Add a test (day 2).** Pick any endpoint and add one more case to its file in `test/e2e/`,
   for example "a customer can't call this admin route". Run just that file:
   ```sh
   npx vitest run --config ./vitest.config.e2e.ts test/e2e/platform.e2e-spec.ts
   ```
3. **Follow the walkthrough (day 3).** [`docs/ADD-AN-ENDPOINT.md`](ADD-AN-ENDPOINT.md) builds a
   real endpoint step by step. Do it on a branch, then throw the branch away.
4. **Fix a small bug or write a missing doc comment (day 4–5).** Ask for a starter task. A good
   first one: improve a validation message, or add a one-line `/** comment */` above a DTO field
   (those comments show up as descriptions on the `/docs` page).

## Rules that keep us safe

These aren't suggestions. Most are checked automatically, so the checks will tell you.

- **Never change an old migration.** The database schema only changes by adding a *new* file in
  `supabase/migrations`. Editing an old one breaks databases that already ran it.
- **Money is whole cents.** `3900` means $39.00. Never use decimals.
- **No SQL or business rules in controllers.** Put them in the service.
- **Don't read environment variables directly** (`process.env`). Use the accessors in `src/config`.
  Lint will stop you.
- **Never put real keys in code, commits or chat.** Your own test keys live only in your `.env` (ignored by git); the
  shop's real keys live only in Render's environment page. Use fake values in tests.
- **Production is real money and real customers.** Never push to `main` directly. Work goes on a
  branch, then `staging`, and only then `main` (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- **Don't change what an endpoint returns without a conversation.** The website depends on the
  exact shape. The route list test (`test/e2e/routes.e2e-spec.ts`) tells you when routes change.

## When something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| `npm run dev:local` says the port is in use | Another copy is running. Stop it (Ctrl+C in its terminal) and retry. |
| A request returns `401` | You're not signed in. Log in and send the `Authorization: Bearer <token>` header. |
| A request returns `403` | You're signed in but your role is too low (staff routes need staff or owner). |
| A request returns `400` with a message | A DTO rejected the input. The message says which field and why. |
| `500` and "An unexpected server error occurred." | A bug. The reply includes a `requestId`; find it in the terminal running the server, where the real error is printed. |
| E2E test fails only sometimes | Tell us. Tests must not be flaky; that's worth fixing. |
| `npm run lint` fails on formatting | Run `npm run format`, then `npm run lint`. |

Still stuck? Ask. Asking early is a good habit here. Share what you ran, what you expected and
what you got (copy the text, not a photo).

## Glossary

- **API / backend / server**: this project. A program that answers requests from the website.
- **Endpoint / route**: one URL the API answers, like `GET /products`.
- **Controller**: the file that lists a feature's routes.
- **Service**: the class that does the work behind a route.
- **DTO** ("data transfer object"): a class describing what a request body or query may contain.
- **Module**: a folder's list of controllers and services (a NestJS idea).
- **Guard**: code that runs before a route and can say no. We use guards for rate limits and
  for who is allowed in.
- **Access level**: who may call a route: `public` (anyone), `user` (signed in), `staff`, `owner`.
- **Migration**: a SQL file that changes the database structure. Numbered by date, applied in order.
- **PGlite**: a Postgres that runs inside Node.js with no install. We use it for local runs and tests.
- **Supabase**: the hosted service that gives us our Postgres database, sign-in, and photo storage.
- **Square**: the shop's point-of-sale system. It owns the products and stock for Square items.
- **Item vs variation** (Square): an *item* is a product ("Rem figure"); a *variation* is one
  sellable version of it (a size, a colour). Prices and stock belong to variations.
- **Pre-order**: a product that isn't in stock yet but can be reserved and paid for until a cutoff date.
- **Hold**: units set aside for a shopper while they check out, so nobody else buys them.
- **Owner / staff / customer**: the three account roles. Owners can do everything; staff run the
  shop; customers shop.
- **Webhook**: a request that Square or PayPal sends *to us* when something happens (a payment
  completed, stock changed).
- **Cashier tool**: the in-person screen at conventions. Take a photo, Claude suggests a title
  and description, and the item is created in Square.
- **Staging**: a full copy of the site with fake payments, used to test before production.
