# Rewards

One points balance per Spin Hobby account, shared by every Spin Hobby app.

- **The shop** gives points for paid orders: each product's goods (its share of any discount; not shipping or tax), times _points per
  dollar_, times the product's own multiplier. They are **on the way** (pending) until the order ships and its return window
  (_return window days_, default 14) has passed, then they join the balance. A refund takes back the refunded share: from points still
  on the way if they are, otherwise from the balance (which can then go below zero). Guests earn nothing.
- **Products** can have their own rule (Admin > product > Rewards points):
  - a promotion, e.g. ×2 until a date;
  - no points at all, e.g. a rare piece;
  - a requirement to buy it, e.g. a hyped release sold at MSRP and kept from scalpers. The requirement is either points from past
    orders (`min_earned_points`; only shop orders count, less refunds, so app and gift points can't unlock it), or other products
    in the same order worth at least `min_other_cents`.
  - The cart quote (and so checkout) takes out a product the buyer doesn't qualify for, with a `REQUIREMENT` warning saying why.
    Requirements apply even while rewards are switched off.
- **Customers** turn points into a one-time discount code (Account > Rewards). 100 points are worth _cents per 100 points_
  (default $1). A code is good for a year and is used at checkout like any other code.
- **Other apps** (Gleamshelf, Hangout, Shelved, …) give and spend points through the API below, with their own key.
- **The owner** switches rewards on, sets the rates, connects apps and gives or takes points by hand (Admin > Rewards). The starting
  values (3 points per $1, 100 points = $1, so 3% back; 500 points to use; 14-day return window) are the table's defaults in the
  migration, and the owner changes them there.

Rewards are **off** until the owner switches them on, because points are worth money. While off, nothing is earned or spent;
balances can still be read.

Code: `src/modules/rewards/` (the arithmetic is in `rewards-math.ts`). Tables: `reward_settings`, `reward_balances` (running total),
`reward_entries` (every change, never edited), `reward_apps`, `reward_links`, `reward_link_codes`,
`reward_product_rules` (migration `20261113120000_rewards.sql`). Tests: `test/e2e/rewards.e2e-spec.ts`.

## Connecting an app

1. In Admin > Rewards > Apps, add the app: a short name (`hangout`), a display name and a daily cap (the most points it may give one
   person in 24 hours). The key (`shr_…`) is shown **once**. Keep it on the app's server side; anyone with it can give points.
   "New key" replaces it and the old one stops at once.
2. The customer opens Account > Rewards on the shop, presses **Link an app** and gets a code like `K7QD-M2PX` (15 minutes, one use).
3. They type it into the app. The app trades it for a **member id** and keeps that. The app never learns the customer's email or
   account id, and the customer can unlink it from their account at any time (the app then gets `404 NOT_LINKED`).

## API for apps

Every call sends `Authorization: Bearer shr_…`. Answers are JSON with `success: true`, or `success: false` and `error` (a
sentence you can show) with a status code.

| Call                                     | Body                                     | Answer                                                     |
| ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `GET /rewards/app`                       |                                          | `{ app: { slug, name, dailyCap } }` (checks the key)       |
| `POST /rewards/link`                     | `{ code }`                               | `{ memberId, balance, worthCents, firstName, enabled }`    |
| `GET /rewards/members/:memberId`         |                                          | `{ balance, worthCents, firstName, enabled }`              |
| `POST /rewards/members/:memberId/award`  | `{ points: 1-10000, reason, ref }`       | `{ balance, duplicate }`                                   |
| `POST /rewards/members/:memberId/spend`  | `{ points: 1-10000, reason, ref }`       | `{ balance, duplicate }`                                   |

- `reason` is what the customer sees in their history ("Won ring toss"), up to 200 characters.
- `ref` is **your** id for the event (`match:8812`, `level:3:user:91`): letters, numbers and `. : @ / - _`. The same `ref` from the
  same app only ever counts once, so retry freely after a timeout; a repeat answers `duplicate: true` with the current balance.
- Errors worth handling: `401` bad or switched-off key · `403 REWARDS_OFF` · `404 NOT_LINKED` · `404 BAD_LINK_CODE` ·
  `409 NOT_ENOUGH_POINTS` (spend) · `429 DAILY_CAP` (award).

```bash
curl -X POST https://api.spinhobby.com/rewards/members/$MEMBER/award \
  -H "Authorization: Bearer $SPIN_REWARDS_KEY" -H 'Content-Type: application/json' \
  -d '{"points": 20, "reason": "Won ring toss", "ref": "match:8812"}'
```

## Rules worth knowing

- A balance can go below zero only when a refund takes back points that were already spent. Spends (by the customer, an app or the
  owner taking points) never go below zero.
- Points from apps and from the owner count at once; only order points wait. Points have no expiry yet. Points codes don't come back if the order that used them is refunded; the owner can give them back by hand.
- Every owner change is in the admin log (`rewards.*`).
