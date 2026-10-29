import { afterAll, describe, expect, it } from 'vitest';
import { placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, staff, shopper } = shop;
await placeSampleOrders(shop); // two paid orders today

const send = (events: unknown) => http.post('/analytics/events').send({ events });
const summary = async (who = staff) =>
  (await http.get('/admin/analytics?days=7').set('Authorization', who.auth).expect(200)).body;

describe('site analytics', () => {
  it('counts each shopping step per day, products for views and carts', async () => {
    await send([{ name: 'visit' }, { name: 'product_view', productId: 'FIG1' }]).expect(204);
    await send([
      { name: 'product_view', productId: 'FIG1' },
      { name: 'add_to_cart', productId: 'FIG1' },
    ]).expect(204);
    await send([
      { name: 'product_view', productId: 'PRZ1' },
      { name: 'checkout_view', productId: 'ignored' },
    ]).expect(204);

    const s = await summary();
    expect(s.totals).toEqual({
      visit: 1,
      product_view: 3,
      add_to_cart: 1,
      checkout_view: 1,
      paid: 2,
    });
    expect(s.daily).toHaveLength(1);
    expect(s.topProducts[0]).toMatchObject({
      id: 'FIG1',
      views: 2,
      carts: 1,
      name: expect.any(String),
    });
    const { rows } = await pglite.query<{ product_id: string }>(
      "select product_id from public.analytics_daily where event = 'checkout_view'",
    );
    expect(rows).toEqual([{ product_id: '' }]); // only views and carts keep a product
  });

  it('keeps nothing about who sent it', async () => {
    const { rows } = await pglite.query<Record<string, unknown>>(
      'select * from public.analytics_daily limit 1',
    );
    expect(Object.keys(rows[0]).sort()).toEqual(['count', 'day', 'event', 'product_id']);
  });

  it('refuses unknown steps and oversized batches', async () => {
    await send([{ name: 'purchase' }]).expect(400);
    await send([]).expect(400);
    await send(Array.from({ length: 21 }, () => ({ name: 'visit' }))).expect(400);
  });

  it('shows the summary to staff only', async () => {
    await http.get('/admin/analytics').expect(401);
    await http.get('/admin/analytics').set('Authorization', shopper.auth).expect(403);
    await http.get('/admin/analytics?days=0').set('Authorization', staff.auth).expect(400);
  });

  it('takes browser error reports', async () => {
    await http
      .post('/client-errors')
      .send({
        message: 'TypeError: x is undefined',
        stack: 'at Checkout (Checkout.tsx:12)',
        page: '/checkout',
        release: 'abc1234',
      })
      .expect(204);
    await http.post('/client-errors').send({}).expect(400);
  });
});
