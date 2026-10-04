import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createApp,
  createDatabase,
  JWT_SECRET,
  mockFetch,
  seedProduct,
  signUp,
} from './harness.js';

export const ORIGIN = 'http://localhost:5173';
export const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
export const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/** A shipping/billing address the checkout accepts. */
export const address = {
  firstName: 'Aki',
  lastName: 'Tanaka',
  address1: '10 Jasper Ave',
  city: 'Edmonton',
  province: 'AB',
  postalCode: 'T5J 0N3',
  country: 'CA',
};

/**
 * Starts the whole API against an in-memory Postgres, with six products and three signed-up users
 * (owner, staff, shopper) already in it, and every integration "configured" with fake credentials.
 * Each spec file calls this once and `await shop.close()` when it is done:
 *
 *   const shop = await startShop();
 *   afterAll(shop.close);
 *   const { http, owner } = shop;
 */
export async function startShop() {
  Object.assign(process.env, {
    SUPABASE_JWT_SECRET: JWT_SECRET,
    OWNER_EMAILS: 'boss@spinhobby.com',
    ALLOWED_ORIGINS: ORIGIN,
    PAYPAL_CLIENT_ID: 'pp-client',
    PAYPAL_CLIENT_SECRET: 'pp-secret',
    PAYPAL_ENV: 'sandbox',
    SQUARE_ACCESS_TOKEN: 'sq-token',
    SQUARE_LOCATION_ID: 'LOC1',
    SQUARE_ENV: 'sandbox',
    SQUARE_APPLICATION_ID: 'sandbox-sq0idb-app',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'whsec',
    SQUARE_WEBHOOK_URL: 'https://api.spinhobby.com/webhooks/square',
    RESEND_API_KEY: 're_test',
    FROM_EMAIL: 'shop@spinhobby.com',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  });
  const db = await createDatabase();
  const pglite: PGlite = db.pglite;
  const app: INestApplication = await createApp(db.driver);
  const http = request(app.getHttpServer());

  await seedProduct(pglite, {
    id: 'FIG1',
    name: 'Rem 1/7 Scale Figure',
    category: 'Scale Figures',
    priceCents: 22900,
    availability: 'preorder',
    orderBy: future(20),
    releaseMonth: '2027-03-01',
    series: 'Re:Zero',
    jan: '4580000000001',
    featured: true,
    rank: 1,
    image: 'https://img/fig1.jpg',
  });
  await seedProduct(pglite, {
    id: 'PRZ1',
    name: 'Miku Prize Figure',
    category: 'Prize Figures',
    priceCents: 3900,
    stock: 12,
    series: 'Vocaloid',
    rank: 2,
  });
  await seedProduct(pglite, {
    id: 'CHB1',
    name: 'Chibi Figure',
    category: 'Chibi Figures',
    priceCents: 6400,
    stock: 2,
    maxPer: 1,
    compareAt: 7900,
  });
  await seedProduct(pglite, {
    id: 'BDG1',
    name: 'Can Badge Set',
    category: 'Badges & Acrylics',
    priceCents: 1800,
    stock: 0,
  });
  await seedProduct(pglite, {
    id: 'OLD1',
    name: 'Closed Pre-order Plush',
    category: 'Plushies',
    priceCents: 5500,
    availability: 'preorder',
    orderBy: past(2),
  });
  await seedProduct(pglite, {
    id: 'HID1',
    name: 'Hidden Convention One-off',
    category: 'Other',
    priceCents: 1000,
    stock: 5,
    availability: 'hidden',
  });

  const owner = await signUp(pglite, 'boss@spinhobby.com');
  const staff = await signUp(pglite, 'helper@spinhobby.com', 'staff');
  const shopper = await signUp(pglite, 'fan@example.com');

  return {
    pglite,
    app,
    http,
    owner,
    staff,
    shopper,
    close: async () => {
      await app.close();
      await pglite.close();
    },
  };
}

export type Shop = Awaited<ReturnType<typeof startShop>>;

/**
 * Gives the shop the two orders most admin screens need to show something: one paid PayPal order for a
 * Miku Prize Figure (bought by the shopper) and one reserved pre-order for the Rem figure, paid by card.
 * It goes through the real checkout endpoints, with the payment providers faked.
 */
export async function placeSampleOrders({ http, shopper, owner }: Shop) {
  const cart = (variationId: string) => ({
    quote: {
      items: [{ variationId, quantity: 1 }],
      shippingMethod: 'standard',
      country: 'CA',
      province: 'AB',
    },
    email: 'Fan@Example.com',
    billing: address,
    shipping: address,
  });
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
    await http
      .post('/checkout/intent')
      .set('Authorization', shopper.auth)
      .send(cart('PRZ1_V'))
      .expect(200);
    await http.post('/paypal/capture').send({ paypalOrderId: 'PP-1' }).expect(200);
  } finally {
    paypal.restore();
  }

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
    const intent = await http.post('/checkout/intent').send(cart('FIG1_V')).expect(200);
    await http
      .post('/square/payments')
      .send({ orderId: intent.body.orderId, email: 'fan@example.com', sourceId: 'cnon:ok' })
      .expect(200);
  } finally {
    square.restore();
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ payment_provider: 'paypal' })
      .expect(200);
  }
}
