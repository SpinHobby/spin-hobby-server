import { afterAll, describe, expect, it } from 'vitest';
import { RemindersScheduler } from '../../src/modules/reminders/reminders.scheduler.js';
import { mockFetch, seedProduct } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, app } = shop;
const scheduler = app.get(RemindersScheduler);

await seedProduct(pglite, {
  id: 'NIP1',
  name: 'Hobby Nipper',
  category: 'Tools',
  priceCents: 2500,
  stock: 30,
});
await seedProduct(pglite, {
  id: 'STD1',
  name: 'Display Stand',
  category: 'Goods',
  priceCents: 1200,
  stock: 30,
});
await seedProduct(pglite, {
  id: 'BIG1',
  name: 'Big Diorama',
  category: 'Goods',
  priceCents: 9900,
  stock: 5,
});

/** A paid order straight in the database: the items' ids, paid `hoursAgo` hours ago. */
async function paidOrder(itemIds: string[], email = 'buyer@example.com', hoursAgo = 24) {
  const paid = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  const { rows } = await pglite.query<{ id: number }>(
    `insert into public.orders (status, provider, subtotal_cents, shipping_cents, total_cents, shipping_method, billing_email,
       billing_address, shipping_address, paid_at)
     values ('paid', 'square', 1000, 0, 1000, 'standard', $1, $2, $2, $3) returning id`,
    [email, JSON.stringify(address), paid],
  );
  for (const id of itemIds)
    await pglite.query(
      `insert into public.order_items (order_id, square_item_id, square_variation_id, name, unit_price_cents, quantity)
       values ($1, $2, $3, $2, 1000, 1)`,
      [rows[0].id, id, `${id}_V`],
    );
}

const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);
const resend = () => mockFetch({ 'api.resend.com': () => ({ id: 'mail' }) });
const sent = (m: ReturnType<typeof mockFetch>) =>
  m.calls
    .filter((c) => c.url.includes('api.resend.com'))
    .map((c) => c.body as { to: string[]; subject: string; html: string });

describe('frequently bought together and add-ons', () => {
  it('come from paid orders only, most often bought first, never sold out', async () => {
    expect(ids((await http.get('/products/PRZ1/bought-together').expect(200)).body)).toEqual([]);
    await paidOrder(['PRZ1', 'NIP1', 'STD1']);
    await paidOrder(['PRZ1', 'NIP1']);
    await paidOrder(['PRZ1', 'BDG1']); // the badge set is sold out
    await pglite.query(
      `insert into public.orders (status, provider, subtotal_cents, shipping_cents, total_cents, shipping_method, billing_email,
         billing_address, shipping_address) values ('pending', 'square', 1, 0, 1, 'standard', 'x@example.com', '{}', '{}')`,
    );
    expect(ids((await http.get('/products/PRZ1/bought-together').expect(200)).body)).toEqual([
      'NIP1',
      'STD1',
    ]);
  });

  it('suggests cheap add-ons for a cart: bought with it first, then best sellers, not what is in the cart', async () => {
    const body = (await http.get('/products/add-ons?ids=PRZ1,STD1').expect(200)).body;
    expect(ids(body)[0]).toBe('NIP1');
    expect(ids(body)).not.toContain('PRZ1');
    expect(ids(body)).not.toContain('STD1');
    expect(ids(body)).not.toContain('BIG1'); // over $30
    expect(ids(body)).not.toContain('BDG1'); // sold out
    expect(body.items.length).toBeLessThanOrEqual(3);
    // an empty cart still gets the cheap best sellers
    expect((await http.get('/products/add-ons').expect(200)).body.items.length).toBeGreaterThan(0);
  });
});

describe('cart reminders (opt-in at checkout)', () => {
  const save = (email: string, lines: unknown[]) =>
    http.post('/checkout/cart-reminder').send({ email, lines });
  const age = (email: string, hours: number) =>
    pglite.query(
      `update public.cart_reminders set updated_at = now() - make_interval(hours => $2) where email = $1`,
      [email, hours],
    );

  it('sends one reminder after a few hours, with a link that opens the same cart', async () => {
    await save('Late@Example.com', [
      { variationId: 'NIP1_V', quantity: 2 },
      { variationId: 'BDG1_V', quantity: 1 }, // sold out: left out of the email and the cart
    ]).expect(200);
    const mail = resend();
    try {
      expect((await scheduler.run()).carts).toBe(0); // not yet: it was just saved
      await age('late@example.com', 4);
      expect((await scheduler.run()).carts).toBe(1);
      expect((await scheduler.run()).carts).toBe(0); // only once
    } finally {
      mail.restore();
    }
    const [email] = sent(mail);
    expect(email.to).toEqual(['late@example.com']);
    expect(email.html).toContain('Hobby Nipper');
    expect(email.html).not.toContain('Can Badge Set');
    const token = /restore=([0-9a-f-]{36})/.exec(email.html)![1];
    expect(email.html).toContain(`/reminders/stop?token=${token}`);

    const cart = (await http.get(`/checkout/cart-reminder/${token}`).expect(200)).body;
    expect(cart.items).toEqual([
      { product: expect.objectContaining({ id: 'NIP1', variationId: 'NIP1_V' }), quantity: 2 },
    ]);
  });

  it('sends nothing once the same email has paid, or after the box is unticked', async () => {
    await save('paid@example.com', [{ variationId: 'NIP1_V', quantity: 1 }]).expect(200);
    await age('paid@example.com', 4);
    await paidOrder(['NIP1'], 'paid@example.com', 1);
    await save('unticked@example.com', [{ variationId: 'NIP1_V', quantity: 1 }]).expect(200);
    await save('unticked@example.com', []).expect(200);
    const mail = resend();
    try {
      expect((await scheduler.run()).carts).toBe(0);
    } finally {
      mail.restore();
    }
  });

  it('stops for good from the email link, after a confirm button', async () => {
    await save('stop@example.com', [{ variationId: 'NIP1_V', quantity: 1 }]).expect(200);
    const { rows } = await pglite.query<{ token: string }>(
      "select token from public.cart_reminders where email = 'stop@example.com'",
    );
    const token = rows[0].token;
    const ask = await http.get(`/reminders/stop?token=${token}`).expect(200);
    expect(ask.text).toContain('confirm=1');
    expect(
      (await pglite.query("select 1 from public.cart_reminders where email = 'stop@example.com'"))
        .rows,
    ).toHaveLength(1);
    await http.get(`/reminders/stop?token=${token}&confirm=1`).expect(200);
    expect(
      (await pglite.query("select 1 from public.cart_reminders where email = 'stop@example.com'"))
        .rows,
    ).toHaveLength(0);
    expect(
      (await pglite.query("select 1 from public.email_opt_outs where email = 'stop@example.com'"))
        .rows,
    ).toHaveLength(1);
    await http.get(`/checkout/cart-reminder/${token}`).expect(404);
    await http.get('/reminders/stop?token=nope').expect(400);
  });

  it('checks what it is sent', async () => {
    await save('not-an-email', [{ variationId: 'NIP1_V', quantity: 1 }]).expect(400);
    await save('a@example.com', [{ variationId: 'NIP1_V', quantity: 0 }]).expect(400);
    await save('a@example.com', 'nope' as never).expect(400);
  });
});

describe('following a series or maker for new pre-orders', () => {
  it('only follows what the shop has; the first run records current pre-orders without emailing', async () => {
    await http
      .post('/follows')
      .send({ email: 'fan@example.com', kind: 'series', name: 'Made Up Series' })
      .expect(400);
    const ok = await http
      .post('/follows')
      .send({ email: 'Fan@Example.com', kind: 'series', name: 're:zero' })
      .expect(200);
    expect(ok.body).toMatchObject({ kind: 'series', name: 'Re:Zero' });
    await http
      .post('/follows')
      .send({ email: 'fan@example.com', kind: 'series', name: 'Re:Zero' })
      .expect(200); // again: fine
    const mail = resend();
    try {
      expect((await scheduler.run()).news).toBe(0); // FIG1 was already a pre-order
    } finally {
      mail.restore();
    }
    expect(sent(mail)).toHaveLength(0);
  });

  it('emails each follower once about a new pre-order from what they follow', async () => {
    await seedProduct(pglite, {
      id: 'FIG2',
      name: 'Emilia 1/7 Scale Figure',
      category: 'Scale Figures',
      priceCents: 24900,
      availability: 'preorder',
      orderBy: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      series: 'Re:Zero',
    });
    await pglite.query(
      "update public.product_metadata set manufacturer = 'Good Smile Company' where square_item_id = 'FIG2'",
    );
    await http
      .post('/follows')
      .send({ email: 'maker@example.com', kind: 'maker', name: 'good smile company' })
      .expect(200);
    await http
      .post('/follows')
      .send({ email: 'fan@example.com', kind: 'maker', name: 'Good Smile Company' })
      .expect(200);
    const mail = resend();
    try {
      expect((await scheduler.run()).news).toBe(2);
      expect((await scheduler.run()).news).toBe(0); // once
    } finally {
      mail.restore();
    }
    const emails = sent(mail);
    const fan = emails.find((e) => e.to[0] === 'fan@example.com')!;
    expect(fan.subject).toBe('New pre-order: Emilia 1/7 Scale Figure');
    expect(fan.html.match(/Emilia 1\/7 Scale Figure<\/a>/g)).toHaveLength(1); // one email, one row, though two follows match
    expect(fan.html).toContain('Stop news about Re:Zero');
    expect(fan.html).toContain('Stop news about Good Smile Company');

    const token = /follows\/stop\?token=([0-9a-f-]{36})/.exec(fan.html)![1];
    await http.get(`/follows/stop?token=${token}&confirm=1`).expect(200);
    const left = await pglite.query<{ name: string }>(
      "select name from public.follows where email = 'fan@example.com'",
    );
    expect(left.rows).toHaveLength(1);
  });
});
