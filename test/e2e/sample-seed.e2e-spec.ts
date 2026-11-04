import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ACCOUNTS,
  clearSampleAccounts,
  sampleAccountEmail,
  seedSampleAccounts,
} from '../../src/modules/sample/accounts.js';
import { sampleImageFor } from '../../src/modules/sample/images.js';
import { seedSample } from '../../src/modules/sample/seed.js';
import { createDatabase } from '../support/harness.js';

describe('sample shop', () => {
  it('records when its paid orders were paid, as a real payment does', async () => {
    const { pglite } = await createDatabase();
    await seedSample(pglite, 'http://localhost:8080');
    const { rows } = await pglite.query<{ status: string; paid: boolean }>(
      'select status, paid_at is not null as paid from public.orders',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const o of rows) expect(o.paid).toBe(!['pending', 'cancelled'].includes(o.status));
    await pglite.close();
  });

  it('adds extra editions when asked (dev:local), each with its own id, JAN and an existing picture', async () => {
    const { pglite } = await createDatabase();
    const seeded = await seedSample(pglite, 'http://localhost:8080', { more: 520 });
    expect(seeded.products).toBeGreaterThan(600);
    const { rows } = await pglite.query<{
      n: number;
      jans: number;
      hidden: number;
      sold_out: number;
    }>(
      `select count(*)::int as n, count(distinct m.jan_code)::int as jans,
              count(*) filter (where m.availability = 'hidden')::int as hidden,
              count(*) filter (where i.quantity = 0)::int as sold_out
         from public.catalog_products p
         join public.product_metadata m using (square_item_id)
         join public.catalog_variations v on v.square_item_id = p.square_item_id
         left join public.inventory_snapshots i using (square_variation_id)`,
    );
    expect(rows[0].n).toBe(seeded.products);
    expect(rows[0].jans).toBe(seeded.products);
    expect(rows[0].hidden).toBeGreaterThan(0);
    expect(rows[0].sold_out).toBeGreaterThan(0);
    const pictures = await pglite.query<{ image_url: string }>(
      "select image_url from public.product_images where square_item_id = 'sample-x1'",
    );
    const drawn = pictures.rows.map((r) => r.image_url).find((u) => u.endsWith('.svg'))!;
    expect(sampleImageFor(drawn.split('/').pop()!)).toContain('<svg');
    await pglite.close();
  });
});

describe('sample accounts', () => {
  it('are mostly customers, each with past orders, favourites and an address', async () => {
    const { pglite } = await createDatabase();
    await seedSample(pglite, 'http://localhost:8080');
    const made = await seedSampleAccounts(pglite, 'http://localhost:8080');
    expect(made.accounts).toBe(SAMPLE_ACCOUNTS.length);
    expect(made.orders).toBeGreaterThan(100);

    const people = (
      await pglite.query<{
        email: string;
        role: string;
        orders: number;
        favourites: number;
        homes: number;
      }>(
        `select p.email, p.role,
           (select count(*)::int from public.orders o where o.user_id = p.id) as orders,
           (select count(*)::int from public.wishlist_items w where w.user_id = p.id) as favourites,
           (select count(*)::int from public.customer_addresses a where a.user_id = p.id and a.is_default) as homes
         from public.profiles p where p.email = any($1::text[])`,
        [SAMPLE_ACCOUNTS.map(sampleAccountEmail)],
      )
    ).rows;
    expect(people).toHaveLength(SAMPLE_ACCOUNTS.length);
    expect(people.filter((p) => p.role === 'customer').length).toBeGreaterThan(people.length * 0.8);
    for (const p of people) {
      expect(p.favourites).toBeGreaterThan(0);
      expect(p.homes).toBe(1);
    }
    expect(people.filter((p) => p.orders >= 5).length).toBeGreaterThan(10);

    // the orders read like real ones: paid unless pending or cancelled, shipped ones tracked, totals add up
    const orders = (
      await pglite.query<any>(
        `select o.status, o.paid_at is not null as paid, o.tracking_number, o.total_cents, o.subtotal_cents + o.shipping_cents + o.tax_cents as sum,
           (select sum(unit_price_cents * quantity)::int from public.order_items i where i.order_id = o.id) as items,
           o.subtotal_cents, extract(epoch from now() - o.created_at) / 86400 as age_days, (select array_agg(event_type order by created_at) from public.order_events e where e.order_id = o.id) as events
         from public.orders o where o.user_id is not null`,
      )
    ).rows;
    for (const o of orders) {
      expect(o.paid).toBe(!['pending', 'cancelled'].includes(o.status));
      expect(o.total_cents).toBe(o.sum);
      expect(o.items).toBe(o.subtotal_cents);
      expect(o.events[0]).toBe('created');
      if (o.status === 'shipped') expect(o.tracking_number).toBeTruthy();
      // only the last few days still wait to ship ('paid' / 'fulfilled' = paid, not shipped yet)
      if (['paid', 'fulfilled'].includes(o.status)) expect(o.age_days).toBeLessThan(7);
    }
    expect(new Set(orders.map((o) => o.status)).size).toBeGreaterThanOrEqual(5);

    const restricted = (
      await pglite.query<{ n: number }>(
        'select count(*)::int as n from public.profiles where banned_at is not null or suspended_until > now()',
      )
    ).rows[0].n;
    expect(restricted).toBe(2);

    // a second start keeps what is there; --reset removes them
    expect((await seedSampleAccounts(pglite, 'http://localhost:8080')).accounts).toBe(0);
    await clearSampleAccounts(pglite);
    const left = await pglite.query<{ n: number }>(
      'select count(*)::int as n from public.orders where user_id is not null',
    );
    expect(left.rows[0].n).toBe(0);
    await pglite.close();
  });

  it('refuse a database with real (Supabase) sign-in', async () => {
    const { pglite } = await createDatabase();
    await pglite.query('alter table auth.users add column encrypted_password text');
    await expect(seedSampleAccounts(pglite, 'http://localhost:8080')).rejects.toThrow(
      'local databases only',
    );
    await pglite.close();
  });
});
