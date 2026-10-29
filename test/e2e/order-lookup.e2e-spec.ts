import { afterAll, describe, expect, it } from 'vitest';
import { placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite } = shop;
await placeSampleOrders(shop); // two paid orders for Fan@Example.com
const [first] = (
  await pglite.query<{ id: number }>(
    "select id from public.orders where status <> 'pending' order by id",
  )
).rows;

const lookup = (order: unknown, email: string) =>
  http.get('/orders/lookup').query({ order, email });

describe('guest order lookup', () => {
  it('finds an order by its number and email, whatever the capitals', async () => {
    const res = await lookup(first.id, 'FAN@example.com').expect(200);
    expect(res.body.order).toMatchObject({
      id: first.id,
      status: 'paid',
      items: [expect.objectContaining({ name: 'Miku Prize Figure', quantity: 1 })],
      shipTo: { city: expect.any(String), province: 'AB', country: 'CA' },
      refundedCents: 0,
    });
    expect(res.body.order.events.map((e: any) => e.type)).toEqual(['created', 'paid']);
  });

  it('gives away nothing a stranger could use', async () => {
    const order = (await lookup(first.id, 'fan@example.com')).body.order;
    const text = JSON.stringify(order);
    for (const secret of ['CAP-1', 'provider_payment_id', 'billing', 'address1', 'fan@example.com'])
      expect(text).not.toContain(secret);
  });

  it('answers a wrong email and a wrong number the same way', async () => {
    const wrongEmail = await lookup(first.id, 'someone@else.com').expect(404);
    const wrongNumber = await lookup(99999, 'fan@example.com').expect(404);
    expect(wrongEmail.body).toEqual(wrongNumber.body);
    expect(wrongEmail.body.error).toMatch(/couldn't find an order/);
  });

  it('skips checkouts that were never paid', async () => {
    const { rows } = await pglite.query<{ id: number }>(
      "insert into public.orders (status, provider, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_method, billing_email, billing_address, shipping_address) values ('pending', 'square', 100, 0, 0, 100, 'standard', 'fan@example.com', '{}', '{}') returning id",
    );
    await lookup(rows[0].id, 'fan@example.com').expect(404);
  });

  it('refuses bad input', async () => {
    await lookup('abc', 'fan@example.com').expect(400);
    await lookup(first.id, 'not-an-email').expect(400);
  });
});
