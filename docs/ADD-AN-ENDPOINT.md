# Walkthrough: add an endpoint

We'll build a small, real endpoint from scratch so you can see every piece:

> **`GET /ops/order-counts?days=7`**: the owner sees how many orders were placed in each status
> (`paid`, `shipped`, …) over the last few days.

It touches every layer: a **DTO** (the input), a **service** (the SQL), a **controller** (the route),
and a **test**. Do it on a throw-away branch (`git checkout -b practice/order-counts`). The code in
this guide was run and passes, so if yours doesn't, compare carefully.

You'll edit these files:

| Step | File |
|---|---|
| 1 | `src/modules/ops/dto/order-counts.query.ts` (new) |
| 2 | `src/modules/ops/ops.service.ts` |
| 3 | `src/modules/ops/ops.controller.ts` |
| 4 | `test/e2e/ops-order-counts.e2e-spec.ts` (new) |
| 5 | `test/e2e/routes.e2e-spec.ts` |

Why the `ops` module? It's the owner-only area, which is where this belongs. It's already wired into
the app, so there's nothing to register. (A brand-new *feature* would get its own folder; see the
last section.)

## Step 1: describe the input (the DTO)

The only input is an optional `days` number. A DTO is a class where each field says what's allowed.

`src/modules/ops/dto/order-counts.query.ts`

```ts
import { Rule } from '../../../common/validation/decorators.js';
import { positiveInteger } from '../../../common/validation/rules.js';

/** `GET /ops/order-counts` options. */
export class OrderCountsQuery {
  /** How many days back to count, 1 to 365 (default 30). */
  @Rule((value) => positiveInteger(value, 'days', 365))
  days = 30;
}
```

What's going on:

- `days = 30` is the default when the caller leaves it out.
- `@Rule(...)` checks the value and cleans it up. Query strings arrive as text (`"7"`), and
  `positiveInteger` turns that into the number `7` or throws a friendly error such as
  `days must be between 1 and 365.`
- The `/** … */` comment shows up as the description on the `/docs` page.

## Step 2: do the work (the service)

Open `src/modules/ops/ops.service.ts`. Add the import at the top and the method inside the class.

```ts
import type { OrderStatus } from '../../database/rows.js';
```

```ts
  /** Orders created in the last `days` days, counted per status. */
  orderCounts(days: number) {
    return this.db.many<{ status: OrderStatus; orders: number }>(
      `select status, count(*)::int as orders from public.orders
        where created_at > now() - make_interval(days => $1::int)
        group by status order by status`,
      [days],
    );
  }
```

What's going on:

- `this.db.many(sql, params)` runs the query and returns all the rows.
- The `<{ status: …; orders: number }>` tells TypeScript the shape of each row, so a typo like
  `row.ordres` is caught immediately.
- `$1` is a **parameter**: the value is passed separately and never pasted into the SQL. That's what
  keeps us safe from SQL injection. Always do this.
- `count(*)::int` makes the count a plain number (Postgres would otherwise send a big integer).

## Step 3: add the route (the controller)

Open `src/modules/ops/ops.controller.ts`. Add `Query` to the NestJS import, import your DTO, and add
a method:

```ts
import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { OrderCountsQuery } from './dto/order-counts.query.js';
```

```ts
  /** How many orders were placed in each status over the last few days. */
  @Get('order-counts')
  async orderCounts(@Query() query: OrderCountsQuery) {
    return { success: true, days: query.days, counts: await this.ops.orderCounts(query.days) };
  }
```

What's going on:

- `@Get('order-counts')` plus the controller's `@Controller('ops')` makes the URL `GET /ops/order-counts`.
- The class already has `@Access('owner')`, so this route is owner-only for free. If you ever add a
  route that should be open to more people, put `@Access('staff')` on that one method.
- `@Query() query: OrderCountsQuery` makes Nest check the query string against the DTO *before* your
  method runs. By the time you read `query.days`, it's a valid number.
- The method does one thing: call the service. All replies start with `success: true`.

Try it: with `npm run dev:local` running, open http://localhost:8080/docs, find **Ops → GET
/ops/order-counts** (it appeared by itself), sign in as the owner (see
[`INTERNS.md`](INTERNS.md)) and press *Execute*.

## Step 4: write a test

Tests live in `test/e2e/`. The `startShop()` helper starts the whole app on an in-memory database
with products and three users (`owner`, `staff`, `shopper`). `placeSampleOrders()` adds a paid order
and a pre-order to count.

`test/e2e/ops-order-counts.e2e-spec.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff } = shop;
await placeSampleOrders(shop); // one paid order and one reserved pre-order

describe('GET /ops/order-counts', () => {
  it('counts recent orders per status', async () => {
    const res = await http.get('/ops/order-counts').set('Authorization', owner.auth).expect(200);
    expect(res.body).toEqual({
      success: true,
      days: 30,
      counts: [
        { status: 'paid', orders: 1 },
        { status: 'preorder_reserved', orders: 1 },
      ],
    });
  });

  it('accepts ?days= and rejects bad values', async () => {
    const res = await http
      .get('/ops/order-counts?days=7')
      .set('Authorization', owner.auth)
      .expect(200);
    expect(res.body.days).toBe(7);
    await http
      .get('/ops/order-counts?days=0')
      .set('Authorization', owner.auth)
      .expect(400, { success: false, error: 'days must be between 1 and 365.' });
  });

  it('is owner-only', async () => {
    await http.get('/ops/order-counts').expect(401); // not signed in
    await http.get('/ops/order-counts').set('Authorization', staff.auth).expect(403); // wrong role
  });
});
```

Run just this file:

```sh
npx vitest run --config ./vitest.config.e2e.ts test/e2e/ops-order-counts.e2e-spec.ts
```

A good test covers three things: **the happy path**, **bad input**, and **who's allowed**.

## Step 5: tell the route list

`test/e2e/routes.e2e-spec.ts` holds the list of every route, so nobody adds or removes one by
accident. Run `npm run test:e2e` now and that test fails, showing the new route. Add the line it
asks for, in alphabetical order:

```ts
  'GET /ops/order-counts [owner]',
```

## Step 6: check everything

```sh
npm run format      # tidy formatting (run it twice if it changed files)
npm run typecheck && npm run lint && npm run format:check && npm test && npm run test:e2e
```

All green? That's what a finished change looks like.

## If your change adds a whole new feature

Make a new folder `src/modules/<feature>/` with the same four kinds of file you just used:

```
src/modules/wishes/
  wishes.module.ts       @Module({ controllers: [WishesController], providers: [WishesService] })
  wishes.controller.ts   routes only
  wishes.service.ts      rules and SQL
  dto/…                  one class per request
```

Then add `WishesModule` to the `imports` list in `src/app.module.ts`. If the feature needs a
service from another module (for example `OrdersService`), that module must `exports` it and yours
must list it in `imports`. Nest will tell you with a clear error if you forget.

If it needs a new table or column, add a **new** migration file in `supabase/migrations`
(`YYYYMMDDHHMMSS_what_it_does.sql`), then add or update the type in `src/database/rows.ts`.

## Common mistakes

- **Putting SQL in the controller.** Move it to the service.
- **Forgetting `await`.** The reply is sent before the work finishes. Lint catches this.
- **Building SQL with string concatenation** (`'... where id = ' + id`). Use `$1` parameters.
- **Returning a different shape** from an endpoint the website already uses. Add new fields; don't rename.
- **Forgetting the access level.** Without `@Access`, a route is public. Put it on the controller for
  the whole folder, as `ops` does.
