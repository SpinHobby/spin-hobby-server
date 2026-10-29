import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApp,
  createDatabase,
  JWT_SECRET,
  mockFetch,
  seedProduct,
  signUp,
} from '../support/harness.js';

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;

const address = {
  firstName: 'Aki <b>',
  lastName: 'Tanaka',
  address1: '10 Jasper Ave',
  city: 'Edmonton',
  province: 'AB',
  postalCode: 'T5J 0N3',
  country: 'CA',
};
const cart = (variationId: string, quantity = 1) => ({
  items: [{ variationId, quantity }],
  shippingMethod: 'standard',
  country: 'CA',
  province: 'AB',
});
const checkout = async (variationId: string, quantity = 1) => {
  const res = await http
    .post('/checkout/intent')
    .send({
      quote: cart(variationId, quantity),
      email: 'fan@example.com',
      billing: address,
      shipping: address,
    })
    .expect(200);
  return res.body.orderId as number;
};
const pay = (orderId: number) =>
  http.post('/square/payments').send({ orderId, email: 'fan@example.com', sourceId: 'cnon:ok' });
const events = async (orderId: number) =>
  (
    await pglite.query<any>(
      'select event_type from public.order_events where order_id = $1 order by id',
      [orderId],
    )
  ).rows.map((r) => r.event_type);

const unique = () => Math.random().toString(36).slice(2);
const square = (resend: () => unknown) =>
  mockFetch({
    '/v2/orders': () => ({ order: { id: `SQ-${unique()}` } }),
    '/v2/payments': () => ({
      payment: { id: `PAY-${unique()}`, status: 'COMPLETED', receipt_url: 'https://sq/r' },
    }),
    'api.resend.com': resend,
  });
const emails = (m: ReturnType<typeof mockFetch>) =>
  m.calls.filter((c) => c.url.includes('api.resend.com'));

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_JWT_SECRET: JWT_SECRET,
    OWNER_EMAILS: 'boss@spinhobby.com',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SQUARE_ACCESS_TOKEN: 'sq-token',
    SQUARE_LOCATION_ID: 'LOC1',
    SQUARE_ENV: 'sandbox',
    RESEND_API_KEY: 're_test',
    FROM_EMAIL: 'shop@spinhobby.com',
    STOREFRONT_URL: 'https://shop.example',
  });
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());
  const owner = await signUp(pglite, 'boss@spinhobby.com');
  await http
    .put('/admin/settings')
    .set('Authorization', owner.auth)
    .send({ payment_provider: 'square' })
    .expect(200);
  await seedProduct(pglite, {
    id: 'FIG1',
    name: 'Rem <script>alert(1)</script> Figure',
    category: 'Figures',
    priceCents: 2500,
    stock: 20,
  });
  await seedProduct(pglite, {
    id: 'PRE1',
    name: 'Pre-order Plush',
    category: 'Plushies',
    priceCents: 4000,
    availability: 'preorder',
  });
});

afterAll(async () => {
  await app?.close();
  await pglite?.close();
});

describe('order confirmation email', () => {
  it('sends a receipt once, to the billing address, with escaped content', async () => {
    const mail = square(() => ({ id: 'e1' }));
    try {
      const orderId = await checkout('FIG1_V', 2);
      await pay(orderId).expect(200);
      const sent = emails(mail);
      expect(sent).toHaveLength(1);
      expect(sent[0].body).toMatchObject({
        to: ['fan@example.com'],
        from: 'shop@spinhobby.com',
        subject: `Your Spin Hobby order #${orderId} is confirmed`,
      });
      const html: string = sent[0].body.html;
      expect(html).toContain(`#${orderId}`);
      expect(html).toContain('$50.00'); // 2 × $25.00 line
      expect(html).toContain('Total (CAD)');
      expect(html).toContain(`/order-status?order=${orderId}"`); // the number only, never the email
      expect(html).toContain('Edmonton');
      expect(html).toContain('2–3 business days');
      expect(html).not.toContain('<script>');
      expect(html).toContain('Rem &lt;script&gt;');
      expect(html).toContain('Aki &lt;b&gt;');
      expect(html).not.toContain('pre-order items ship');
      expect(await events(orderId)).toEqual(['created', 'paid', 'confirmation_emailed']);

      await pay(orderId).expect(200); // the shopper retries: no second receipt
      expect(emails(mail)).toHaveLength(1);
    } finally {
      mail.restore();
    }
  });

  it('tells pre-order shoppers when those items ship', async () => {
    const mail = square(() => ({ id: 'e2' }));
    try {
      const orderId = await checkout('PRE1_V');
      await pay(orderId).expect(200);
      expect(emails(mail)[0].body.html).toContain('(pre-order)');
      expect(emails(mail)[0].body.html).toContain('pre-order items ship');
    } finally {
      mail.restore();
    }
  });

  it('never fails a paid checkout because the mail provider is down', async () => {
    const mail = square(() => new Response('nope', { status: 500 }));
    try {
      const orderId = await checkout('FIG1_V');
      const res = await pay(orderId).expect(200);
      expect(res.body.status).toBe('paid');
      expect(emails(mail)).toHaveLength(1);
      expect(await events(orderId)).toEqual(['created', 'paid']); // no confirmation recorded
    } finally {
      mail.restore();
    }
  });

  it('survives the mail provider being unreachable', async () => {
    const mail = square(() => {
      throw new Error('socket hang up');
    });
    try {
      const orderId = await checkout('FIG1_V');
      expect((await pay(orderId).expect(200)).body.status).toBe('paid');
      expect(await events(orderId)).toEqual(['created', 'paid']);
    } finally {
      mail.restore();
    }
  });

  it('does nothing when email is not configured', async () => {
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const mail = square(() => ({ id: 'never' }));
    try {
      const orderId = await checkout('FIG1_V');
      expect((await pay(orderId).expect(200)).body.status).toBe('paid');
      expect(emails(mail)).toHaveLength(0);
      expect(await events(orderId)).toEqual(['created', 'paid']);
    } finally {
      mail.restore();
      process.env.RESEND_API_KEY = saved;
    }
  });
});
