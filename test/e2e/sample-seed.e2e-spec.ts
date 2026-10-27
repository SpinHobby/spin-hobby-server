import { describe, expect, it } from 'vitest';
import {
  SAMPLE_ACCOUNTS,
  clearSampleAccounts,
  sampleAccountEmail,
  seedSampleAccounts,
} from '../../src/modules/sample/accounts.js';
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
           o.subtotal_cents, (select array_agg(event_type order by created_at) from public.order_events e where e.order_id = o.id) as events
         from public.orders o where o.user_id is not null`,
      )
    ).rows;
    for (const o of orders) {
      expect(o.paid).toBe(!['pending', 'cancelled'].includes(o.status));
      expect(o.total_cents).toBe(o.sum);
      expect(o.items).toBe(o.subtotal_cents);
      expect(o.events[0]).toBe('created');
      if (['shipped', 'fulfilled'].includes(o.status)) expect(o.tracking_number).toBeTruthy();
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
