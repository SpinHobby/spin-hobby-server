import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch, signUp } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff, shopper } = shop;

describe('cart quote', () => {
  const quote = (items: any[], extra: Record<string, unknown> = {}) =>
    http
      .post('/cart/quote')
      .send({ items, shippingMethod: 'standard', country: 'CA', province: 'AB', ...extra });

  it('prices lines server-side with shipping and provincial tax', async () => {
    const res = await quote([{ variationId: 'PRZ1_V', quantity: 1 }]).expect(200);
    expect(res.body).toMatchObject({
      subtotalCents: 3900,
      shippingCents: 899,
      taxCents: Math.round((3900 + 899) * 0.05),
      warnings: [],
    });
    expect(res.body.totalCents).toBe(3900 + 899 + res.body.taxCents);
    const free = await quote([{ variationId: 'PRZ1_V', quantity: 2 }], { province: 'ON' }).expect(
      200,
    );
    expect(free.body).toMatchObject({
      subtotalCents: 7800,
      shippingCents: 0,
      taxCents: Math.round(7800 * 0.13),
    });
    const express = await quote([{ variationId: 'PRZ1_V', quantity: 2 }], {
      shippingMethod: 'express',
    }).expect(200);
    expect(express.body.shippingCents).toBe(1999);
  });

  it('warns about stock, limits and closed pre-orders', async () => {
    const res = await quote([
      { variationId: 'CHB1_V', quantity: 2 }, // stock 2 but max 1 per customer
      { variationId: 'BDG1_V', quantity: 1 }, // sold out
      { variationId: 'OLD1_V', quantity: 1 }, // pre-order closed
      { variationId: 'FIG1_V', quantity: 3 }, // pre-order: no stock limit
    ]).expect(200);
    expect(res.body.warnings.map((w: any) => w.code)).toEqual([
      'LIMIT_EXCEEDED',
      'OUT_OF_STOCK',
      'PREORDER_CLOSED',
    ]);
    expect(res.body.lines).toEqual([
      expect.objectContaining({
        variationId: 'FIG1_V',
        quantity: 3,
        isPreorder: true,
        imageUrl: 'https://img/fig1.jpg',
      }),
    ]);
  });

  it('rejects malformed carts with the storefront messages', async () => {
    await quote([]).expect(400, {
      success: false,
      error: 'Your cart must contain between 1 and 40 items.',
    });
    await quote([{ variationId: 'PRZ1_V', quantity: 1 }], { province: '' }).expect(400);
    await quote([{ variationId: 'PRZ1_V', quantity: 0 }]).expect(400, {
      success: false,
      error: 'quantity must be between 1 and 99.',
    });
    await quote([{ variationId: 'MISSING', quantity: 1 }]).expect(400, {
      success: false,
      error: 'One or more products are no longer available.',
    });
  });
});

describe('checkout', () => {
  const body = (items: any[]) => ({
    quote: { items, shippingMethod: 'standard', country: 'CA', province: 'AB' },
    email: 'Fan@Example.com',
    billing: address,
    shipping: address,
  });

  it('creates a PayPal order and captures it', async () => {
    const paypal = mockFetch({
      '/v1/oauth2/token': () => ({ access_token: 'tok' }),
      '/v2/checkout/orders/PP-1/capture': () => ({
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }],
        links: [{ rel: 'self', href: 'https://pp/receipt' }],
      }),
      '/v2/checkout/orders': () => ({ id: 'PP-1' }),
    });
    try {
      const intent = await http
        .post('/checkout/intent')
        .set('Authorization', shopper.auth)
        .send(body([{ variationId: 'PRZ1_V', quantity: 1 }]))
        .expect(200);
      expect(intent.body).toMatchObject({
        success: true,
        provider: 'paypal',
        paypalOrderId: 'PP-1',
      });
      const order = (
        await pglite.query<any>('select * from public.orders where id = $1', [intent.body.orderId])
      ).rows[0];
      expect(order).toMatchObject({
        status: 'pending',
        billing_email: 'fan@example.com',
        user_id: shopper.id,
        total_cents: 3900 + 899 + 240,
      });
      const created = paypal.calls.find((c) => c.url.endsWith('/v2/checkout/orders'))!;
      expect(created.body.purchase_units[0].amount).toEqual({
        currency_code: 'CAD',
        value: '50.39',
      });

      const capture = await http
        .post('/paypal/capture')
        .send({ paypalOrderId: 'PP-1' })
        .expect(200);
      expect(capture.body).toEqual({ success: true, orderId: intent.body.orderId, status: 'paid' });
      await http.post('/paypal/capture').send({ paypalOrderId: 'PP-1' }).expect(200); // idempotent retry
      const events = await pglite.query<any>(
        'select event_type from public.order_events where order_id = $1 order by id',
        [intent.body.orderId],
      );
      expect(events.rows.map((e) => e.event_type)).toEqual(['created', 'paid']);
      const mine = await http.get('/orders').set('Authorization', shopper.auth).expect(200);
      expect(mine.body.items.map((o: any) => o.id)).toContain(intent.body.orderId);
      await http.get(`/orders/${intent.body.orderId}`).set('Authorization', staff.auth).expect(200);
      const other = await signUp(pglite, 'other@example.com');
      await http.get(`/orders/${intent.body.orderId}`).set('Authorization', other.auth).expect(404);
    } finally {
      paypal.restore();
    }
  });

  it('refuses to create an order when the cart changed, returning the fresh quote', async () => {
    const res = await http
      .post('/checkout/intent')
      .send(body([{ variationId: 'BDG1_V', quantity: 1 }]))
      .expect(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'CART_CHANGED',
      quote: { warnings: [{ code: 'OUT_OF_STOCK' }] },
    });
    const count = await pglite.query<any>(
      "select count(*)::int as n from public.orders where billing_email = 'fan@example.com'",
    );
    expect(count.rows[0].n).toBe(1); // only the PayPal order above
  });

  it('charges a Square card and reserves pre-orders', async () => {
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ payment_provider: 'square' })
      .expect(200);
    const square = mockFetch({
      '/v2/orders': () => ({ order: { id: 'SQ-ORDER' } }),
      '/v2/payments': () => ({
        payment: { id: 'SQ-PAY', status: 'COMPLETED', receipt_url: 'https://sq/receipt' },
      }),
    });
    try {
      const intent = await http
        .post('/checkout/intent')
        .send(body([{ variationId: 'FIG1_V', quantity: 1 }]))
        .expect(200);
      expect(intent.body).toMatchObject({
        provider: 'square',
        amountCents: Math.round(22900 * 1.05),
        currency: 'CAD',
      });
      await http
        .post('/square/payments')
        .send({ orderId: intent.body.orderId, email: 'wrong@example.com', sourceId: 'cnon:ok' })
        .expect(404);
      const paid = await http
        .post('/square/payments')
        .send({
          orderId: intent.body.orderId,
          email: 'fan@example.com',
          sourceId: 'cnon:ok',
          verificationToken: 'vt',
        })
        .expect(200);
      expect(paid.body.status).toBe('preorder_reserved');
      const payment = square.calls.find((c) => c.url.endsWith('/v2/payments'))!;
      expect(payment.body).toMatchObject({
        source_id: 'cnon:ok',
        order_id: 'SQ-ORDER',
        location_id: 'LOC1',
        verification_token: 'vt',
        amount_money: { amount: Math.round(22900 * 1.05), currency: 'CAD' },
      });
    } finally {
      square.restore();
      await http
        .put('/admin/settings')
        .set('Authorization', owner.auth)
        .send({ payment_provider: 'paypal' })
        .expect(200);
    }
  });
});
