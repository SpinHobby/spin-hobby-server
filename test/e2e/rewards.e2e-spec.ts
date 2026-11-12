import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff, shopper } = shop;

const cart = (discountCode?: string) => ({
  items: [{ variationId: 'PRZ1_V', quantity: 2 }], // 2 x $39.00 = $78.00 of goods
  shippingMethod: 'standard',
  country: 'CA',
  province: 'AB',
  ...(discountCode ? { discountCode } : {}),
});
const mine = async () =>
  (await http.get('/account/rewards').set('Authorization', shopper.auth).expect(200)).body;
const settings = (body: Record<string, unknown>, who = owner) =>
  http.put('/admin/rewards/settings').set('Authorization', who.auth).send(body);

let paid = 0;
/** The shopper, signed in, buys the cart by card; returns the order id. */
async function buy(discountCode?: string) {
  paid += 1;
  const square = mockFetch({
    '/v2/orders': () => ({ order: { id: `SQ-ORDER-R${paid}` } }),
    '/v2/payments': () => ({
      payment: { id: `SQ-PAY-R${paid}`, status: 'COMPLETED', receipt_url: null },
    }),
    'api.resend.com': () => ({ id: 'e' }),
  });
  try {
    const intent = await http
      .post('/checkout/intent')
      .set('Authorization', shopper.auth)
      .send({
        quote: cart(discountCode),
        email: 'fan@example.com',
        billing: address,
        shipping: address,
      })
      .expect(200);
    await http
      .post('/square/payments')
      .send({ orderId: intent.body.orderId, email: 'fan@example.com', sourceId: 'cnon:ok' })
      .expect(200);
    return intent.body.orderId as number;
  } finally {
    square.restore();
  }
}

describe('rewards', () => {
  let orderId = 0;
  let hangoutKey = '';
  let memberId = '';

  it('are off until the owner switches them on, and only the owner can', async () => {
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ payment_provider: 'square' })
      .expect(200);
    await buy();
    expect(await mine()).toMatchObject({ enabled: false, balance: 0, entries: [] });
    await http
      .post('/account/rewards/redeem')
      .set('Authorization', shopper.auth)
      .send({ points: 500 })
      .expect(403);

    await settings({ enabled: true }, staff).expect(403);
    await http.get('/admin/rewards').set('Authorization', staff.auth).expect(403);
    await settings({ pointsPerDollar: 500 }).expect(400);
    const on = await settings({ enabled: true, pointsPerDollar: 10 }).expect(200);
    expect(on.body.settings).toEqual({
      enabled: true,
      pointsPerDollar: 10,
      centsPer100Points: 100,
      minRedeemPoints: 500,
    });
    await http.get('/account/rewards').expect(401);
  });

  it('gives a signed-in customer points for the goods in a paid order', async () => {
    orderId = await buy();
    const me = await mine();
    expect(me.balance).toBe(780);
    expect(me.worthCents).toBe(780);
    expect(me.entries).toEqual([
      expect.objectContaining({
        app: 'shop',
        appName: 'Spin Hobby shop',
        points: 780,
        reason: `Order #${orderId}`,
      }),
    ]);
  });

  it('turns points into a one-time discount code that works at checkout', async () => {
    const redeem = (points: number) =>
      http.post('/account/rewards/redeem').set('Authorization', shopper.auth).send({ points });
    expect((await redeem(400).expect(400)).body.error).toMatch(/500 points or more/);
    expect((await redeem(5000).expect(400)).body.error).toMatch(/You have 780 points/);
    const made = (await redeem(500).expect(200)).body;
    expect(made).toMatchObject({ valueCents: 500, points: 500, balance: 280 });
    expect(made.code).toMatch(/^PTS-[A-Z2-9]{10}$/);

    const q = (await http.post('/cart/quote').send(cart(made.code)).expect(200)).body;
    expect(q.discountCents).toBe(500);
    expect(q.discount.label).toBe('$5.00 off');
    expect((await mine()).codes).toEqual([
      expect.objectContaining({ code: made.code, valueCents: 500, points: 500 }),
    ]);
  });

  it('lets the owner connect another app with a key shown once', async () => {
    const create = (body: Record<string, unknown>, who = owner) =>
      http.post('/admin/rewards/apps').set('Authorization', who.auth).send(body);
    await create({ slug: 'hangout', name: 'Hangout' }, staff).expect(403);
    await create({ slug: 'shop', name: 'Nope' }).expect(400);
    const made = (await create({ slug: 'hangout', name: 'Hangout', dailyCap: 100 }).expect(200))
      .body;
    expect(made.key).toMatch(/^shr_/);
    expect(made.app).toMatchObject({ slug: 'hangout', daily_cap: 100, active: true });
    await create({ slug: 'hangout', name: 'Again' }).expect(409);
    hangoutKey = made.key;

    await http.get('/rewards/app').expect(401);
    await http.get('/rewards/app').set('Authorization', 'Bearer shr_wrong').expect(401);
    const me = await http
      .get('/rewards/app')
      .set('Authorization', `Bearer ${hangoutKey}`)
      .expect(200);
    expect(me.body.app).toEqual({ slug: 'hangout', name: 'Hangout', dailyCap: 100 });
  });

  it('links an app with a short code from the account; the app never sees the email', async () => {
    const app = (path: string) => http.post(path).set('Authorization', `Bearer ${hangoutKey}`);
    const made = (
      await http.post('/account/rewards/link-code').set('Authorization', shopper.auth).expect(200)
    ).body;
    expect(made.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    await app('/rewards/link').send({ code: 'ZZZZ-ZZZZ' }).expect(404);
    const linked = (
      await app('/rewards/link')
        .send({ code: ` ${made.code.replace('-', '').toLowerCase()} ` })
        .expect(200)
    ).body;
    expect(linked).toMatchObject({ balance: 280, worthCents: 280, enabled: true });
    expect(JSON.stringify(linked)).not.toContain('fan@example.com');
    memberId = linked.memberId;
    await app('/rewards/link').send({ code: made.code }).expect(404); // used once

    expect((await mine()).links).toEqual([
      expect.objectContaining({ app: 'hangout', name: 'Hangout' }),
    ]);
  });

  it('lets a linked app give points up to its daily cap, and counts a repeated ref once', async () => {
    const award = (body: Record<string, unknown>) =>
      http
        .post(`/rewards/members/${memberId}/award`)
        .set('Authorization', `Bearer ${hangoutKey}`)
        .send(body);
    expect(
      (await award({ points: 60, reason: 'Won ring toss', ref: 'game:1' }).expect(200)).body,
    ).toEqual({
      success: true,
      balance: 340,
      duplicate: false,
    });
    expect(
      (await award({ points: 60, reason: 'Won ring toss', ref: 'game:1' }).expect(200)).body,
    ).toEqual({
      success: true,
      balance: 340,
      duplicate: true,
    });
    expect(
      (await award({ points: 50, reason: 'Again', ref: 'game:2' }).expect(429)).body.error,
    ).toMatch(/up to 100 points a day/);
    await award({ points: 0, reason: 'x', ref: 'game:3' }).expect(400);
    await award({ points: 5, reason: 'x', ref: 'has spaces' }).expect(400);
  });

  it('lets a linked app spend points the member has, and nothing more', async () => {
    const spend = (points: number, ref: string) =>
      http
        .post(`/rewards/members/${memberId}/spend`)
        .set('Authorization', `Bearer ${hangoutKey}`)
        .send({ points, reason: 'Outfit', ref });
    expect((await spend(1000, 'buy:1').expect(409)).body.error).toBe('Not enough points.');
    expect((await spend(40, 'buy:2').expect(200)).body.balance).toBe(300);
    const read = await http
      .get(`/rewards/members/${memberId}`)
      .set('Authorization', `Bearer ${hangoutKey}`)
      .expect(200);
    expect(read.body.balance).toBe(300);
    expect((await mine()).entries.slice(0, 2)).toEqual([
      expect.objectContaining({
        app: 'hangout',
        appName: 'Hangout',
        points: -40,
        reason: 'Outfit',
      }),
      expect.objectContaining({ app: 'hangout', points: 60, reason: 'Won ring toss' }),
    ]);
  });

  it("keeps one app away from another app's members, and stops a switched-off or unlinked app", async () => {
    const other = (
      await http
        .post('/admin/rewards/apps')
        .set('Authorization', owner.auth)
        .send({ slug: 'gleamshelf', name: 'Gleamshelf' })
        .expect(200)
    ).body.key;
    await http
      .get(`/rewards/members/${memberId}`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);

    await http
      .patch('/admin/rewards/apps/gleamshelf')
      .set('Authorization', owner.auth)
      .send({ active: false })
      .expect(200);
    await http.get('/rewards/app').set('Authorization', `Bearer ${other}`).expect(401);

    const fresh = (
      await http
        .post('/admin/rewards/apps/hangout/key')
        .set('Authorization', owner.auth)
        .expect(200)
    ).body.key;
    await http.get('/rewards/app').set('Authorization', `Bearer ${hangoutKey}`).expect(401);
    hangoutKey = fresh;

    await http
      .delete('/account/rewards/links/hangout')
      .set('Authorization', shopper.auth)
      .expect(200);
    await http
      .get(`/rewards/members/${memberId}`)
      .set('Authorization', `Bearer ${hangoutKey}`)
      .expect(404);
    expect((await mine()).links).toEqual([]);
  });

  it('takes back the points of a refunded order, even below zero', async () => {
    const paypal = mockFetch({
      'api.resend.com': () => ({ id: 'e' }),
      '/v2/refunds': () => ({ refund: { id: 'RF1' } }),
    });
    try {
      await http
        .post(`/admin/orders/${orderId}/refund`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);
    } finally {
      paypal.restore();
    }
    const me = await mine();
    expect(me.balance).toBe(300 - 780);
    expect(me.entries[0]).toMatchObject({ points: -780, reason: `Refund on order #${orderId}` });
  });

  it('lets the owner give or take points by hand, never taking below zero', async () => {
    const adjust = (body: Record<string, unknown>, who = owner) =>
      http.post('/admin/rewards/adjust').set('Authorization', who.auth).send(body);
    await adjust({ email: 'fan@example.com', points: 1000, reason: 'Sorry' }, staff).expect(403);
    await adjust({ email: 'nobody@example.com', points: 10, reason: 'x' }).expect(404);
    await adjust({ email: 'fan@example.com', points: 0, reason: 'x' }).expect(400);
    expect(
      (await adjust({ email: 'FAN@example.com', points: 1000, reason: 'Sorry' }).expect(200)).body
        .balance,
    ).toBe(520);
    await adjust({ email: 'fan@example.com', points: -600, reason: 'Oops' }).expect(409);

    const overview = (await http.get('/admin/rewards').set('Authorization', owner.auth).expect(200))
      .body;
    expect(overview.totals).toMatchObject({
      outstandingPoints: 520,
      outstandingCents: 520,
      members: 1,
    });
    expect(overview.apps.map((a: { slug: string }) => a.slug)).toEqual(['hangout', 'gleamshelf']);
    expect(overview.recent[0]).toMatchObject({
      email: 'fan@example.com',
      app: 'admin',
      points: 1000,
    });
  });
});
