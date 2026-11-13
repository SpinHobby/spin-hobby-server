import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff, shopper, pglite } = shop;

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
      returnWindowDays: 14,
    });
    await http.get('/account/rewards').expect(401);
  });

  it('gives a paid order its points on the way, usable once it has shipped and its return window has passed', async () => {
    orderId = await buy();
    const header = () =>
      http.get('/account/rewards/balance').set('Authorization', shopper.auth).expect(200);
    let me = await mine();
    expect(me).toMatchObject({ balance: 0, pending: 780, worthCents: 0 });
    expect(me.entries).toEqual([
      expect.objectContaining({
        app: 'shop',
        appName: 'Spin Hobby shop',
        points: 780,
        reason: `Order #${orderId}`,
        pending: true,
        availableAt: null,
      }),
    ]);
    expect((await header()).body).toEqual({
      success: true,
      enabled: true,
      balance: 0,
      pending: 780,
    });
    await http.get('/account/rewards/balance').expect(401);

    // shipped: the 14-day clock starts
    await http
      .post(`/admin/orders/${orderId}/ship`)
      .set('Authorization', staff.auth)
      .send({ trackingNumber: 'CP-R1', carrier: 'Canada Post' })
      .expect(200);
    me = await mine();
    expect(me).toMatchObject({ balance: 0, pending: 780 });
    const until = Date.parse(me.entries[0].availableAt);
    expect(until - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    expect(until - Date.now()).toBeLessThan(14.1 * 86_400_000);

    // two weeks later
    await pglite.query(
      "update public.reward_entries set available_at = now() - interval '1 minute' where order_id = $1",
      [orderId],
    );
    expect((await header()).body).toMatchObject({ balance: 780, pending: 0 });
    me = await mine();
    expect(me).toMatchObject({ balance: 780, pending: 0, worthCents: 780 });
    expect(me.entries[0]).toMatchObject({ points: 780, pending: false });
  });

  it('takes back points still on the way when an unshipped order is refunded, without touching the balance', async () => {
    const second = await buy();
    expect(await mine()).toMatchObject({ balance: 780, pending: 780 });
    const refund = mockFetch({
      'api.resend.com': () => ({ id: 'e' }),
      '/v2/refunds': () => ({ refund: { id: 'RF0' } }),
    });
    try {
      await http
        .post(`/admin/orders/${second}/refund`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);
    } finally {
      refund.restore();
    }
    const me = await mine();
    expect(me).toMatchObject({ balance: 780, pending: 0 });
    expect(me.entries[0]).toMatchObject({
      points: -780,
      reason: `Refund on order #${second}`,
      pending: true,
    });
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

  it('lets a product earn more as a promotion, or nothing at all, set on the product', async () => {
    const rule = (id: string, body: Record<string, unknown>, who = owner) =>
      http.put(`/admin/rewards/products/${id}`).set('Authorization', who.auth).send(body);
    const points = async () => (await http.get('/products/PRZ1/points').expect(200)).body;
    const quote = async () => (await http.post('/cart/quote').send(cart()).expect(200)).body;

    // normal: 10 points per dollar on $39 and on the $78 cart
    expect(await points()).toEqual({
      success: true,
      enabled: true,
      points: 390,
      multiplier: 1,
      endsAt: null,
      requirement: null,
      earned: null,
      emailConfirmed: null,
    });
    expect((await quote()).rewardPoints).toBe(780);
    expect(
      (await http.get('/admin/rewards/products/PRZ1').set('Authorization', staff.auth).expect(200))
        .body,
    ).toEqual({ success: true, rule: null });

    await rule('PRZ1', { multiplier: 2 }, staff).expect(403);
    await rule('NOPE', { multiplier: 2 }).expect(404);
    await rule('PRZ1', { multiplier: 11 }).expect(400);
    await rule('PRZ1', { multiplier: 2, endsAt: '2020-01-01' }).expect(400);
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const set = await rule('PRZ1', {
      multiplier: 2,
      endsAt: until,
      note: 'Double points week',
    }).expect(200);
    expect(set.body.rule).toMatchObject({ multiplier: 2, note: 'Double points week' });
    expect(await points()).toMatchObject({
      points: 780,
      multiplier: 2,
      endsAt: set.body.rule.endsAt,
    });
    expect((await quote()).rewardPoints).toBe(1_560);

    // the order is paid at double points
    const order = await buy();
    expect((await mine()).entries[0]).toMatchObject({
      points: 1_560,
      pending: true,
      reason: `Order #${order}`,
    });

    // a rare piece: no points
    await rule('FIG1', { multiplier: 0, note: 'Rare' }).expect(200);
    expect((await http.get('/products/FIG1/points').expect(200)).body).toMatchObject({
      points: 0,
      multiplier: 0,
    });
    const overview = (await http.get('/admin/rewards').set('Authorization', owner.auth).expect(200))
      .body;
    expect(overview.products).toEqual([
      expect.objectContaining({ productId: 'PRZ1', multiplier: 2 }),
      expect.objectContaining({ productId: 'FIG1', name: 'Rem 1/7 Scale Figure', multiplier: 0 }),
    ]);
    expect(overview.totals.pendingPoints).toBe(1_560);

    // back to normal
    expect((await rule('PRZ1', { multiplier: 1 }).expect(200)).body.rule).toBeNull();
    expect((await quote()).rewardPoints).toBe(780);

    // while rewards are off, nothing is promised
    await settings({ enabled: false }).expect(200);
    expect(await points()).toEqual({
      success: true,
      enabled: false,
      requirement: null,
      earned: null,
      emailConfirmed: null,
    });
    expect((await quote()).rewardPoints).toBeNull();
  });

  it('keeps a product for customers with enough points from past orders, or with enough else in the same order', async () => {
    await settings({ enabled: true }).expect(200);
    const rule = (body: Record<string, unknown>) =>
      http.put('/admin/rewards/products/CHB1').set('Authorization', owner.auth).send(body);
    const chibi = (extra: { variationId: string; quantity: number }[] = []) => ({
      items: [{ variationId: 'CHB1_V', quantity: 1 }, ...extra],
      shippingMethod: 'standard',
      country: 'CA',
      province: 'AB',
    });
    const quote = async (body: object, who?: { auth: string }) => {
      const req = http.post('/cart/quote');
      if (who) req.set('Authorization', who.auth);
      return (await req.send(body).expect(200)).body;
    };

    // from shop orders the shopper has 1,560 points (two orders were refunded; gifts and app points don't count)
    await rule({ multiplier: 1, minEarnedPoints: 5_000 }).expect(200);
    let q = await quote(chibi(), shopper);
    expect(q.lines).toEqual([]);
    expect(q.warnings).toEqual([
      expect.objectContaining({
        code: 'REQUIREMENT',
        message:
          'Chibi Figure is for customers with 5,000 points from past orders. You have 1,560.',
      }),
    ]);
    expect((await quote(chibi())).warnings[0].message).toMatch(/Sign in to buy it/);
    const page = (
      await http.get('/products/CHB1/points').set('Authorization', shopper.auth).expect(200)
    ).body;
    expect(page).toMatchObject({
      requirement: { minEarnedPoints: 5_000, minOtherCents: null },
      earned: 1_560,
      emailConfirmed: true,
    });

    await rule({ multiplier: 1, minEarnedPoints: 1_500 }).expect(200);
    q = await quote(chibi(), shopper);
    expect(q.lines.map((l: { itemId: string }) => l.itemId)).toEqual(['CHB1']);
    expect(q.warnings).toEqual([]);

    // enough points, but an email never confirmed: one person can't stack fresh accounts on a limited item
    await pglite.query('update public.profiles set email_verified_at = null where id = $1', [
      shopper.id,
    ]);
    q = await quote(chibi(), shopper);
    expect(q.lines).toEqual([]);
    expect(q.warnings[0].message).toMatch(/confirmed their email/);
    await pglite.query('update public.profiles set email_verified_at = now() where id = $1', [
      shopper.id,
    ]);

    // checkout asks the same: a signed-out buyer can't get past it
    const intent = await http
      .post('/checkout/intent')
      .send({ quote: chibi(), email: 'x@example.com', billing: address, shipping: address });
    expect(intent.status).toBe(409);

    // same order: $50 of other items
    await rule({ multiplier: 1, minOtherCents: 5_000 }).expect(200);
    expect((await quote(chibi([{ variationId: 'PRZ1_V', quantity: 1 }]))).warnings[0].message).toBe(
      'Chibi Figure needs at least $50.00 of other items in the same order.',
    );
    q = await quote(chibi([{ variationId: 'PRZ1_V', quantity: 2 }]));
    expect(q.lines).toHaveLength(2);
    expect(q.warnings).toEqual([]);

    // nothing asked, normal points: the rule goes
    expect((await rule({ multiplier: 1 }).expect(200)).body.rule).toBeNull();
    expect((await quote(chibi())).warnings).toEqual([]);
  });
});
