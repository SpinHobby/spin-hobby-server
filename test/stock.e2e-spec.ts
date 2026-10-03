import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrdersService } from '../src/orders/orders.service.js';
import { createApp, createDatabase, JWT_SECRET, mockFetch, seedProduct, signUp } from './harness.js';

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;
let owner: Awaited<ReturnType<typeof signUp>>;

const address = { firstName: 'Aki', lastName: 'Tanaka', address1: '10 Jasper Ave', city: 'Edmonton', province: 'AB', postalCode: 'T5J 0N3', country: 'CA' };
const cart = (items: { variationId: string; quantity: number }[]) => ({ items, shippingMethod: 'standard', country: 'CA', province: 'AB' });
const intent = (items: { variationId: string; quantity: number }[], email = 'fan@example.com') =>
  http.post('/checkout/intent').send({ quote: cart(items), email, billing: address, shipping: address });
const quote = (items: { variationId: string; quantity: number }[]) => http.post('/cart/quote').send(cart(items));
const stockOf = async (variationId: string) => (await pglite.query<any>('select quantity from public.inventory_snapshots where square_variation_id = $1', [variationId])).rows[0]?.quantity;
const backdate = (orderId: number, minutes: number) =>
  pglite.query(`update public.orders set created_at = now() - make_interval(mins => $2::int) where id = $1`, [orderId, minutes]);
const status = async (orderId: number) => (await pglite.query<any>('select status from public.orders where id = $1', [orderId])).rows[0].status;

/** Square answers the order + payment calls; anything else the code tries to call fails the test. */
const squareOk = () => mockFetch({
  '/v2/orders': () => ({ order: { id: `SQ-ORDER-${Math.random().toString(36).slice(2)}` } }),
  '/v2/payments': () => ({ payment: { id: `SQ-PAY-${Math.random().toString(36).slice(2)}`, status: 'COMPLETED', receipt_url: 'https://sq/receipt' } }),
});
const pay = (orderId: number, email = 'fan@example.com') => http.post('/square/payments').send({ orderId, email, sourceId: 'cnon:ok' });

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_JWT_SECRET: JWT_SECRET,
    OWNER_EMAILS: 'boss@spinhobby.com',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1', SQUARE_ENV: 'sandbox', SQUARE_APPLICATION_ID: 'sandbox-sq0idb-app',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'whsec', SQUARE_WEBHOOK_URL: 'https://api.spinhobby.com/webhooks/square',
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  });
  delete process.env.RESEND_API_KEY; // emails are covered in their own spec
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());
  owner = await signUp(pglite, 'boss@spinhobby.com');
  await http.put('/admin/settings').set('Authorization', owner.auth).send({ payment_provider: 'square' }).expect(200);

  await seedProduct(pglite, { id: 'LAST1', name: 'Last One A', category: 'Figures', priceCents: 5000, stock: 1 });
  await seedProduct(pglite, { id: 'LAST2', name: 'Last One B', category: 'Figures', priceCents: 5000, stock: 1 });
  await seedProduct(pglite, { id: 'LAST3', name: 'Last One C', category: 'Figures', priceCents: 5000, stock: 1 });
  await seedProduct(pglite, { id: 'HOLD1', name: 'Hold Test', category: 'Figures', priceCents: 2000, stock: 5 });
  await seedProduct(pglite, { id: 'EXP1', name: 'Expiry Test', category: 'Figures', priceCents: 2000, stock: 2 });
  await seedProduct(pglite, { id: 'SQ1', name: 'Square Sourced', category: 'Figures', priceCents: 2500, stock: 5 });
  await seedProduct(pglite, { id: 'manual-1', name: 'Hand Entered', category: 'Figures', priceCents: 1500, stock: 3 });
  await pglite.query("update public.catalog_products set source = 'manual' where square_item_id = 'manual-1'");
});

afterAll(async () => {
  await app?.close();
  await pglite?.close();
});

describe('stock holds', () => {
  it('gives the last unit to one shopper and tells the other the cart changed', async () => {
    const first = await intent([{ variationId: 'LAST1_V', quantity: 1 }]).expect(200);
    const second = await intent([{ variationId: 'LAST1_V', quantity: 1 }], 'other@example.com').expect(409);
    expect(second.body).toMatchObject({ code: 'CART_CHANGED', quote: { warnings: [{ code: 'OUT_OF_STOCK' }] } });
    expect(await status(first.body.orderId)).toBe('pending');
  });

  it('lets exactly one of two simultaneous shoppers win', async () => {
    const results = await Promise.all([
      intent([{ variationId: 'LAST2_V', quantity: 1 }]),
      intent([{ variationId: 'LAST2_V', quantity: 1 }], 'other@example.com'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const held = await pglite.query<any>("select count(*)::int as n from public.order_items where square_variation_id = 'LAST2_V'");
    expect(held.rows[0].n).toBe(1);
  });

  it('shrinks what the cart quote offers by what others are holding', async () => {
    await intent([{ variationId: 'HOLD1_V', quantity: 3 }]).expect(200);
    const res = await quote([{ variationId: 'HOLD1_V', quantity: 4 }]).expect(200);
    expect(res.body.warnings).toEqual([expect.objectContaining({ code: 'QTY_REDUCED' })]);
    expect(res.body.lines).toEqual([expect.objectContaining({ variationId: 'HOLD1_V', quantity: 2 })]);
  });

  it('stops holding stock once the hold window has passed', async () => {
    const order = await intent([{ variationId: 'EXP1_V', quantity: 2 }]).expect(200);
    expect((await quote([{ variationId: 'EXP1_V', quantity: 2 }]).expect(200)).body.warnings).toHaveLength(1);
    await backdate(order.body.orderId, 31);
    expect((await quote([{ variationId: 'EXP1_V', quantity: 2 }]).expect(200)).body.warnings).toEqual([]);
  });

  it('cancels abandoned checkouts and records why', async () => {
    const orders = app.get(OrdersService);
    const order = await intent([{ variationId: 'EXP1_V', quantity: 1 }], 'abandon@example.com').expect(200);
    await backdate(order.body.orderId, 45);
    expect(await orders.expireStale()).toBeGreaterThanOrEqual(1);
    expect(await status(order.body.orderId)).toBe('cancelled');
    const events = await pglite.query<any>('select event_type from public.order_events where order_id = $1 order by id', [order.body.orderId]);
    expect(events.rows.map((e) => e.event_type)).toEqual(['created', 'expired']);
    expect(await orders.expireStale()).toBe(0);
  });
});

describe('capturing a checkout', () => {
  it('refuses to charge an expired checkout and never calls Square', async () => {
    const order = await intent([{ variationId: 'SQ1_V', quantity: 1 }], 'late@example.com').expect(200);
    await backdate(order.body.orderId, 60);
    await app.get(OrdersService).expireStale();
    const square = mockFetch({});
    try {
      const res = await pay(order.body.orderId, 'late@example.com').expect(409);
      expect(res.body).toMatchObject({ success: false, code: 'ORDER_EXPIRED' });
      expect(square.calls).toHaveLength(0);
    } finally {
      square.restore();
    }
  });

  it('re-checks a lapsed checkout and refuses it when someone else took the stock', async () => {
    const mine = await intent([{ variationId: 'LAST3_V', quantity: 1 }], 'slow@example.com').expect(200);
    await backdate(mine.body.orderId, 31); // hold lapsed, but the cleanup job hasn't run yet
    await intent([{ variationId: 'LAST3_V', quantity: 1 }], 'quick@example.com').expect(200);
    const square = mockFetch({});
    try {
      const res = await pay(mine.body.orderId, 'slow@example.com').expect(409);
      expect(res.body.code).toBe('ORDER_EXPIRED');
      expect(square.calls).toHaveLength(0);
    } finally {
      square.restore();
    }
  });

  it('takes hand-entered stock off when paid, exactly once', async () => {
    const square = squareOk();
    try {
      const order = await intent([{ variationId: 'manual-1_V', quantity: 2 }], 'manual@example.com').expect(200);
      const paid = await pay(order.body.orderId, 'manual@example.com').expect(200);
      expect(paid.body.status).toBe('paid');
      expect(await stockOf('manual-1_V')).toBe(1);
      const row = (await pglite.query<any>('select paid_at from public.orders where id = $1', [order.body.orderId])).rows[0];
      expect(row.paid_at).toBeTruthy();

      await pay(order.body.orderId, 'manual@example.com').expect(200); // retry
      const again = await app.get(OrdersService).markPaid(order.body.orderId, 'whatever', null, {});
      expect(again).toEqual({ status: 'paid', first: false });
      expect(await stockOf('manual-1_V')).toBe(1);
      const events = await pglite.query<any>("select count(*)::int as n from public.order_events where order_id = $1 and event_type = 'paid'", [order.body.orderId]);
      expect(events.rows[0].n).toBe(1);
    } finally {
      square.restore();
    }
  });

  it('leaves Square-sourced stock to Square but counts the sale until Square reports it', async () => {
    const square = squareOk();
    try {
      const order = await intent([{ variationId: 'SQ1_V', quantity: 1 }], 'sq@example.com').expect(200);
      await pay(order.body.orderId, 'sq@example.com').expect(200);
      expect(await stockOf('SQ1_V')).toBe(5); // untouched: Square owns this number
      const unreflected = await quote([{ variationId: 'SQ1_V', quantity: 5 }]).expect(200);
      expect(unreflected.body.lines[0].quantity).toBe(4); // 5 in the old snapshot, 1 already sold

      const raw = JSON.stringify({ event_id: 'evt-sq1', type: 'inventory.count.updated', created_at: new Date().toISOString(),
        data: { object: { inventory_counts: [{ catalog_object_id: 'SQ1_V', state: 'IN_STOCK', quantity: '4' }] } } });
      const sig = createHmac('sha256', 'whsec').update('https://api.spinhobby.com/webhooks/square' + raw).digest('base64');
      await http.post('/webhooks/square').set('Content-Type', 'application/json').set('x-square-hmacsha256-signature', sig).send(raw).expect(200);
      const reflected = await quote([{ variationId: 'SQ1_V', quantity: 4 }]).expect(200);
      expect(reflected.body.warnings).toEqual([]);
      expect(reflected.body.lines[0].quantity).toBe(4);
    } finally {
      square.restore();
    }
  });

  it('honours a payment that lands just after its checkout expired', async () => {
    const order = await intent([{ variationId: 'EXP1_V', quantity: 1 }], 'race@example.com').expect(200);
    await backdate(order.body.orderId, 90);
    await app.get(OrdersService).expireStale();
    expect(await status(order.body.orderId)).toBe('cancelled');
    // The provider already took the money, so the order must not be left cancelled.
    expect(await app.get(OrdersService).markPaid(order.body.orderId, 'LATE-PAY', null, { source: 'test' })).toEqual({ status: 'paid', first: true });
    const event = (await pglite.query<any>("select data from public.order_events where order_id = $1 and event_type = 'paid'", [order.body.orderId])).rows[0];
    expect(event.data).toMatchObject({ late: true });
  });
});
