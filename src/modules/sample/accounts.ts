/**
 * Sample shopper accounts for local development only: `npm run dev:local` (and a DEV_DATABASE_URL database) load them on
 * start, so the account page, Admin > Accounts, Orders and Audit have real-looking people to show. Mostly customers, each
 * with a year of past orders, favourites (wishlist hearts), saved addresses and restock alerts; plus a staff member with
 * audit access, one suspended and one banned customer. They sign in with the dev password (`spinhobby`).
 *
 * Never on staging or production, where every account is a real person: the seeder refuses any database whose auth.users
 * is Supabase's (it only runs against the stub the local scripts create). Run it after seedSample; it needs the catalog.
 */
import { SAMPLE_PRODUCTS, type SampleProduct } from './catalog.js';
import type { SampleDb } from './seed.js';

/** Every sample account's email ends with this, so the dev sign-in list and clean-up can find them. */
export const SAMPLE_ACCOUNT_DOMAIN = 'spinhobby.test';

type Restriction =
  { kind: 'suspended'; days: number; reason: string } | { kind: 'banned'; reason: string };

interface SampleAccount {
  first: string;
  last: string;
  role: 'customer' | 'staff';
  canAudit?: boolean;
  /** Address lines: street, city, province, postal code. */
  home: [string, string, string, string];
  /** A second saved address (work, a parent's place...), not the default. */
  other?: [string, string, string, string];
  /** How many past orders. */
  orders: number;
  /** How many favourites (wishlist hearts). */
  favourites: number;
  /** Months since they signed up. */
  joined: number;
  restriction?: Restriction;
}

export const SAMPLE_ACCOUNTS: SampleAccount[] = [
  {
    first: 'Hana',
    last: 'Yamamoto',
    role: 'customer',
    home: ['88 Bloor St E', 'Toronto', 'ON', 'M4W 3G9'],
    other: ['200 Bay St', 'Toronto', 'ON', 'M5J 2J2'],
    orders: 14,
    favourites: 9,
    joined: 13,
  },
  {
    first: 'Daniel',
    last: 'Okafor',
    role: 'customer',
    home: ['1501 Howe St', 'Vancouver', 'BC', 'V6Z 1R8'],
    orders: 11,
    favourites: 6,
    joined: 12,
  },
  {
    first: 'Chloé',
    last: 'Gagnon',
    role: 'customer',
    home: ['1250 Rue Peel', 'Montréal', 'QC', 'H3B 4W8'],
    other: ['45 Rue Saint-Louis', 'Québec', 'QC', 'G1R 3Z2'],
    orders: 9,
    favourites: 7,
    joined: 11,
  },
  {
    first: 'Ryan',
    last: 'Mitchell',
    role: 'customer',
    home: ['330 5 Ave SW', 'Calgary', 'AB', 'T2P 0L4'],
    orders: 12,
    favourites: 4,
    joined: 12,
  },
  {
    first: 'Priya',
    last: 'Sharma',
    role: 'customer',
    home: ['4700 Kingsway', 'Burnaby', 'BC', 'V5H 4M1'],
    other: ['2329 W Mall', 'Vancouver', 'BC', 'V6T 1Z4'],
    orders: 8,
    favourites: 10,
    joined: 10,
  },
  {
    first: 'Tom',
    last: 'Leblanc',
    role: 'customer',
    home: ['1505 Barrington St', 'Halifax', 'NS', 'B3J 3K5'],
    orders: 7,
    favourites: 5,
    joined: 9,
  },
  {
    first: 'Yuki',
    last: 'Tanaka',
    role: 'customer',
    home: ['10220 103 Ave NW', 'Edmonton', 'AB', 'T5J 0K4'],
    orders: 13,
    favourites: 8,
    joined: 13,
  },
  {
    first: 'Grace',
    last: 'Liu',
    role: 'customer',
    home: ['5000 Yonge St', 'North York', 'ON', 'M2N 7E9'],
    orders: 10,
    favourites: 6,
    joined: 8,
  },
  {
    first: 'Mateo',
    last: 'Garcia',
    role: 'customer',
    home: ['201 Portage Ave', 'Winnipeg', 'MB', 'R3B 3K6'],
    orders: 6,
    favourites: 3,
    joined: 7,
  },
  {
    first: 'Zoe',
    last: 'Anderson',
    role: 'customer',
    home: ['2002 Victoria Ave', 'Regina', 'SK', 'S4P 0R7'],
    other: ['110 21st St E', 'Saskatoon', 'SK', 'S7K 0B6'],
    orders: 9,
    favourites: 7,
    joined: 10,
  },
  {
    first: 'Arjun',
    last: 'Mehta',
    role: 'customer',
    home: ['100 King St W', 'Hamilton', 'ON', 'L8P 1A2'],
    orders: 8,
    favourites: 9,
    joined: 6,
  },
  {
    first: 'Isabelle',
    last: 'Roy',
    role: 'customer',
    home: ['150 Elgin St', 'Ottawa', 'ON', 'K2P 1L4'],
    orders: 5,
    favourites: 4,
    joined: 5,
  },
  {
    first: 'Ben',
    last: 'Fraser',
    role: 'customer',
    home: ['93 Water St', 'St. John’s', 'NL', 'A1C 1A5'],
    orders: 4,
    favourites: 6,
    joined: 4,
  },
  {
    first: 'Leah',
    last: 'Cohen',
    role: 'customer',
    home: ['1 Dundas St W', 'Toronto', 'ON', 'M5G 1Z3'],
    orders: 3,
    favourites: 8,
    joined: 3,
  },
  {
    first: 'Kai',
    last: 'Wilson',
    role: 'customer',
    home: ['800 Burrard St', 'Vancouver', 'BC', 'V6Z 2V8'],
    orders: 2,
    favourites: 3,
    joined: 2,
  },
  {
    first: 'Amara',
    last: 'Diallo',
    role: 'customer',
    home: ['77 Westmorland St', 'Fredericton', 'NB', 'E3B 6Z3'],
    orders: 1,
    favourites: 5,
    joined: 1,
  },
  {
    first: 'Sam',
    last: 'Novak',
    role: 'customer',
    home: ['16 Queen St', 'Charlottetown', 'PE', 'C1A 4A1'],
    orders: 0,
    favourites: 2,
    joined: 0,
  },
  {
    first: 'Victor',
    last: 'Hale',
    role: 'customer',
    home: ['5 Main St', 'Moncton', 'NB', 'E1C 1B8'],
    orders: 6,
    favourites: 2,
    joined: 9,
    restriction: { kind: 'suspended', days: 45, reason: 'Two chargebacks under review' },
  },
  {
    first: 'Rex',
    last: 'Botley',
    role: 'customer',
    home: ['9 Industrial Rd', 'Mississauga', 'ON', 'L5T 1A1'],
    orders: 3,
    favourites: 1,
    joined: 8,
    restriction: { kind: 'banned', reason: 'Reselling bot buying every pre-order' },
  },
  {
    first: 'Nina',
    last: 'Park',
    role: 'staff',
    canAudit: true,
    home: ['60 Bloor St W', 'Toronto', 'ON', 'M4W 3B8'],
    orders: 2,
    favourites: 4,
    joined: 6,
  },
];

export const sampleAccountEmail = (a: Pick<SampleAccount, 'first'>) =>
  `${a.first
    .normalize('NFD')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase()}@${SAMPLE_ACCOUNT_DOMAIN}`;

/** The same numbers on every start (mulberry32), so a screenshot or a bug report stays reproducible. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Throws unless auth.users is the local scripts' stub (Supabase's has encrypted_password): real databases get no fake people. */
async function assertLocalDatabase(db: SampleDb) {
  const { rows } = await db.query(
    "select count(*)::int as n from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password'",
  );
  if (rows[0].n > 0)
    throw new Error('Sample accounts are for local databases only; this one has Supabase sign-in.');
}

const HOUR = 1;
const DAY = 24 * HOUR;

/** Loads SAMPLE_ACCOUNTS with their orders, favourites, addresses and alerts. Accounts already there are left alone. */
export async function seedSampleAccounts(db: SampleDb, imageBase: string) {
  await assertLocalDatabase(db);
  const base = imageBase.replace(/\/$/, '');
  const picture = (p: SampleProduct) => p.photo ?? `${base}/sample-images/${p.slug}.svg`;
  const taxRates = new Map(
    (
      await db.query(
        "select province, rate::float as rate from public.tax_rates where country = 'CA'",
      )
    ).rows.map((r) => [r.province as string, Number(r.rate)]),
  );
  const { rows: owners } = await db.query(
    "select id from public.profiles where role = 'owner' limit 1",
  );
  const ownerId: string | null = owners[0]?.id ?? null;

  const visible = SAMPLE_PRODUCTS.filter((p) => p.availability !== 'hidden');
  const inStock = visible.filter(
    (p) => p.availability !== 'preorder' && (p.stock === null || p.stock > 0),
  );
  const preorders = visible.filter((p) => p.availability === 'preorder');
  const soldOut = visible.filter((p) => p.availability !== 'preorder' && p.stock === 0);

  const made = { accounts: 0, orders: 0, favourites: 0, addresses: 0, alerts: 0 };
  let orderNumber = 0;
  for (const [n, a] of SAMPLE_ACCOUNTS.entries()) {
    const email = sampleAccountEmail(a);
    const exists = await db.query('select id from public.profiles where email = $1', [email]);
    if (exists.rows[0]) continue;
    const rand = random(1000 + n);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
    const joinedHours = a.joined * 30 * DAY + Math.floor(rand() * 20 * DAY) + 2 * DAY;

    const { rows } = await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), $1, jsonb_build_object('first_name', $2::text, 'last_name', $3::text)) returning id",
      [email, a.first, a.last],
    );
    const id: string = rows[0].id;
    await db.query(
      `update public.profiles set role = $2, can_audit = $3, created_at = now() - ($4 || ' hours')::interval, updated_at = now() - ($4 || ' hours')::interval,
         suspended_until = $5::timestamptz, banned_at = $6::timestamptz, restriction_reason = $7, restricted_by = case when $7::text is null then null else $8::uuid end
       where id = $1`,
      [
        id,
        a.role,
        a.canAudit ?? false,
        joinedHours,
        a.restriction?.kind === 'suspended'
          ? new Date(Date.now() + a.restriction.days * 86_400_000).toISOString()
          : null,
        a.restriction?.kind === 'banned'
          ? new Date(Date.now() - 12 * 86_400_000).toISOString()
          : null,
        a.restriction?.reason ?? null,
        ownerId,
      ],
    );
    made.accounts++;

    // Saved addresses: home is the default.
    const places = a.other ? [a.home, a.other] : [a.home];
    for (const [k, [address1, city, province, postalCode]] of places.entries()) {
      await db.query(
        `insert into public.customer_addresses (user_id, first_name, last_name, address1, city, province, postal_code, country, phone, is_default, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'CA', $8, $9, now() - ($10 || ' hours')::interval)`,
        [
          id,
          a.first,
          a.last,
          address1,
          city,
          province,
          postalCode,
          `+1 555 01${String(n).padStart(2, '0')}`,
          k === 0,
          joinedHours - k * 10 * DAY,
        ],
      );
      made.addresses++;
    }

    // Favourites: a mix of in-stock, pre-order and sold-out pieces, hearted at different times.
    const hearts = new Set<SampleProduct>();
    while (hearts.size < Math.min(a.favourites, visible.length)) hearts.add(pick(visible));
    for (const p of hearts) {
      await db.query(
        "insert into public.wishlist_items (user_id, square_item_id, created_at) values ($1, $2, now() - ($3 || ' hours')::interval)",
        [id, p.id, Math.floor(rand() * Math.min(joinedHours, 200 * DAY)) + HOUR],
      );
      made.favourites++;
    }

    // Restock alerts for some sold-out favourites (or any sold-out piece).
    const wanted = [...hearts].filter((p) => soldOut.includes(p));
    if (soldOut.length && rand() < 0.5) wanted.push(pick(soldOut));
    for (const p of new Set(wanted)) {
      await db.query(
        "insert into public.stock_alerts (email, square_variation_id, user_id, created_at) values ($1, $2, $3, now() - ($4 || ' hours')::interval) on conflict do nothing",
        [email, `${p.id}-v`, id, Math.floor(rand() * 60 * DAY) + HOUR],
      );
      made.alerts++;
    }

    // Past orders, oldest first, spread from sign-up to now. Old ones have arrived; the newest may still be on their way.
    for (let k = 0; k < a.orders; k++) {
      const ageHours = Math.max(
        3 * HOUR,
        Math.floor(joinedHours * (1 - (k + 0.3 + rand() * 0.6) / Math.max(a.orders, 1))),
      );
      const recent = ageHours < 6 * DAY;
      const roll = rand();
      const status: string = recent
        ? roll < 0.35
          ? 'paid'
          : roll < 0.6
            ? 'shipped'
            : roll < 0.75
              ? 'pending'
              : 'preorder_reserved'
        : roll < 0.62
          ? 'fulfilled'
          : roll < 0.74
            ? 'shipped'
            : roll < 0.84
              ? 'preorder_reserved'
              : roll < 0.93
                ? 'refunded'
                : 'cancelled';
      const pool = status === 'preorder_reserved' ? preorders : inStock;
      const items = new Map<SampleProduct, number>();
      const lines = 1 + Math.floor(rand() * 3);
      for (let j = 0; j < lines; j++) {
        const p = pick(pool.length ? pool : inStock);
        items.set(p, (items.get(p) ?? 0) + (rand() < 0.15 ? 2 : 1));
      }
      const subtotal = [...items].reduce((t, [p, q]) => t + p.priceCents * q, 0);
      const express = rand() < 0.2;
      const shipping = subtotal >= 7500 && !express ? 0 : express ? 1999 : 899;
      const [address1, city, province, postalCode] = a.other && rand() < 0.25 ? a.other : a.home;
      const tax = Math.round((subtotal + shipping) * (taxRates.get(province) ?? 0));
      const address = JSON.stringify({
        firstName: a.first,
        lastName: a.last,
        address1,
        city,
        province,
        postalCode,
        country: 'CA',
      });
      const paid = status !== 'pending' && status !== 'cancelled';
      const shipped = status === 'shipped' || status === 'fulfilled' || status === 'refunded';
      const paidAge = ageHours - Math.min(ageHours - 1, Math.floor(rand() * 20) + 1) / 60;
      const shippedAge = Math.max(1, ageHours - (1 + Math.floor(rand() * 3)) * DAY);
      orderNumber++;

      const order = await db.query(
        `insert into public.orders (user_id, status, provider, provider_payment_id, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_method, billing_email, billing_address, shipping_address, tracking_number, carrier, shipped_at, created_at, updated_at, paid_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13,
                 case when $14 then now() - ($15 || ' hours')::interval end,
                 now() - ($16 || ' hours')::interval,
                 now() - ($17 || ' hours')::interval,
                 case when $18 then now() - ($19 || ' hours')::interval end) returning id`,
        [
          id,
          status,
          rand() < 0.3 ? 'square' : 'paypal',
          `SAMPLE-A${String(orderNumber).padStart(4, '0')}`,
          subtotal,
          shipping,
          tax,
          subtotal + shipping + tax,
          express ? 'express' : 'standard',
          email,
          address,
          shipped ? `CA${String(700000000 + orderNumber * 7919)}` : null,
          shipped ? 'Canada Post' : null,
          shipped,
          shippedAge,
          ageHours,
          shipped ? shippedAge : ageHours,
          paid,
          paidAge,
        ],
      );
      const orderId = order.rows[0].id;
      for (const [p, q] of items) {
        await db.query(
          'insert into public.order_items (order_id, square_item_id, square_variation_id, name, image_url, unit_price_cents, quantity, is_preorder) values ($1, $2, $3, $4, $5, $6, $7, $8)',
          [
            orderId,
            p.id,
            `${p.id}-v`,
            p.name,
            picture(p),
            p.priceCents,
            q,
            p.availability === 'preorder',
          ],
        );
      }

      // The order's history, as checkout and the admin would have written it.
      const events: [string, number, object][] = [['created', ageHours, {}]];
      if (paid) events.push(['paid', paidAge, { amount_cents: subtotal + shipping + tax }]);
      if (status === 'cancelled') events.push(['cancelled', ageHours - 0.5, {}]);
      if (shipped) events.push(['shipped', shippedAge, { carrier: 'Canada Post' }]);
      if (status === 'refunded')
        events.push([
          'refunded',
          Math.max(0.5, shippedAge - 5 * DAY),
          { amount_cents: subtotal + shipping + tax },
        ]);
      for (const [type, age, data] of events) {
        await db.query(
          "insert into public.order_events (order_id, event_type, data, created_at) values ($1, $2, $3, now() - ($4 || ' hours')::interval)",
          [orderId, type, JSON.stringify(data), Math.max(0.1, age)],
        );
      }
      made.orders++;
    }
  }
  return made;
}

/** Removes the sample accounts (their orders, favourites, addresses and alerts go with them), for `dev:local --reset`. */
export async function clearSampleAccounts(db: SampleDb) {
  await assertLocalDatabase(db);
  const emails = SAMPLE_ACCOUNTS.map(sampleAccountEmail);
  await db.query(
    'delete from public.orders where user_id in (select id from public.profiles where email = any($1::text[]))',
    [emails],
  );
  await db.query('delete from public.stock_alerts where email = any($1::text[])', [emails]);
  await db.query('delete from auth.users where email = any($1::text[])', [emails]);
}
