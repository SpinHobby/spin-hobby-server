import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff } = shop;

const cart = (discountCode?: string) => ({
  items: [{ variationId: 'PRZ1_V', quantity: 2 }], // 2 x $39.00 = $78.00
  shippingMethod: 'standard',
  country: 'CA',
  province: 'AB',
  ...(discountCode !== undefined ? { discountCode } : {}),
});
const quote = async (code?: string) =>
  (await http.post('/cart/quote').send(cart(code)).expect(200)).body;
const create = (body: Record<string, unknown>, who = owner) =>
  http.post('/admin/discounts').set('Authorization', who.auth).send(body);

describe('discount codes', () => {
  it('are managed by the owner only', async () => {
    await create({ code: 'NOPE', kind: 'percent', value: 10 }, staff).expect(403);
    await http.get('/admin/discounts').set('Authorization', staff.auth).expect(403);
    await create({ code: 'x', kind: 'percent', value: 10 }).expect(400);
    await create({ code: 'BIG', kind: 'percent', value: 150 }).expect(400);
  });

  it('take a percentage off the goods; tax and free shipping follow the discounted price', async () => {
    await create({ code: 'save10', kind: 'percent', value: 10, note: 'Discord' }).expect(200);
    const plain = await quote();
    expect(plain).toMatchObject({
      discountCents: 0,
      shippingCents: 0,
      discount: null,
      discountMessage: null,
    });

    const q = await quote(' Save10 ');
    expect(q.discount).toEqual({ code: 'SAVE10', label: '10% off' });
    expect(q.discountCents).toBe(780);
    expect(q.shippingCents).toBe(899); // $70.20 of goods is under the $75 free-shipping line
    expect(q.totalCents).toBe(q.subtotalCents - q.discountCents + q.shippingCents + q.taxCents);
  });

  it("says why a code doesn't apply, without blocking the cart", async () => {
    const q = await quote('NOSUCHCODE');
    expect(q).toMatchObject({
      discount: null,
      discountCents: 0,
      discountMessage: "That code isn't valid.",
    });
    await create({ code: 'BIGSPEND', kind: 'amount', value: 2000, minSubtotalCents: 10000 }).expect(
      200,
    );
    expect((await quote('BIGSPEND')).discountMessage).toBe(
      'That code needs an order of $100.00 or more.',
    );
  });

  it('charges the discounted total, tells Square about the discount, and counts the use once paid', async () => {
    const square = mockFetch({
      '/v2/orders': () => ({ order: { id: 'SQ-ORDER-D' } }),
      '/v2/payments': () => ({
        payment: { id: 'SQ-PAY-D', status: 'COMPLETED', receipt_url: null },
      }),
      'api.resend.com': () => ({ id: 'e' }),
    });
    try {
      await http
        .put('/admin/settings')
        .set('Authorization', owner.auth)
        .send({ payment_provider: 'square' })
        .expect(200);
      const intent = await http
        .post('/checkout/intent')
        .send({
          quote: cart('SAVE10'),
          email: 'deal@example.com',
          billing: address,
          shipping: address,
        })
        .expect(200);
      const before = (await http.get('/admin/discounts').set('Authorization', owner.auth)).body
        .codes;
      expect(before.find((c: any) => c.code === 'SAVE10').uses).toBe(0); // not counted for an unpaid checkout

      await http
        .post('/square/payments')
        .send({ orderId: intent.body.orderId, email: 'deal@example.com', sourceId: 'cnon:ok' })
        .expect(200);
      const order = (
        await pglite.query<any>('select * from public.orders where id = $1', [intent.body.orderId])
      ).rows[0];
      expect(order).toMatchObject({ discount_code: 'SAVE10', discount_cents: 780 });
      const squareOrder = square.calls.find((c) => c.url.endsWith('/v2/orders'))!.body.order;
      expect(squareOrder.discounts).toEqual([
        expect.objectContaining({
          name: 'Code SAVE10',
          amount_money: { amount: 780, currency: 'CAD' },
          scope: 'ORDER',
        }),
      ]);
      const payment = square.calls.find((c) => c.url.endsWith('/v2/payments'))!.body;
      expect(payment.amount_money.amount).toBe(order.total_cents);
      const receipt = square.calls.find((c) => c.url.includes('api.resend.com'))!.body.html;
      expect(receipt).toContain('Discount (SAVE10)');
      expect(receipt).toContain('-$7.80');

      const after = (await http.get('/admin/discounts').set('Authorization', owner.auth)).body
        .codes;
      expect(after.find((c: any) => c.code === 'SAVE10').uses).toBe(1);
    } finally {
      square.restore();
      await http
        .put('/admin/settings')
        .set('Authorization', owner.auth)
        .send({ payment_provider: 'paypal' })
        .expect(200);
    }
  });

  it('refuses a code that stopped working before paying, so the shopper sees the new price first', async () => {
    const codes = (await http.get('/admin/discounts').set('Authorization', owner.auth)).body.codes;
    const id = codes.find((c: any) => c.code === 'SAVE10').id;
    await http
      .patch(`/admin/discounts/${id}`)
      .set('Authorization', owner.auth)
      .send({ active: false })
      .expect(200);
    const res = await http
      .post('/checkout/intent')
      .send({
        quote: cart('SAVE10'),
        email: 'late@example.com',
        billing: address,
        shipping: address,
      })
      .expect(409);
    expect(res.body.code).toBe('CART_CHANGED');
    expect(res.body.quote).toMatchObject({
      discount: null,
      discountMessage: "That code isn't valid.",
    });
  });

  it('stop at their use limit', async () => {
    const made = (
      await create({ code: 'ONCE', kind: 'amount', value: 500, maxUses: 1 }).expect(200)
    ).body.code;
    await pglite.query('update public.discount_codes set uses = 1 where id = $1', [made.id]);
    expect((await quote('ONCE')).discountMessage).toBe('That code has been used up.');
  });
});
