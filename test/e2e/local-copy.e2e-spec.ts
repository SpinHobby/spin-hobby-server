import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { address, startShop } from '../support/shop.js';

/**
 * A local copy of the shop with no keys (an intern's computer): checkout completes with a test payment, and only there. The test shop has every
 * integration "configured" with fake keys; each test takes away what it needs and puts it back.
 */
const shop = await startShop();
const { http } = shop;
afterAll(() => shop.close());

const saved = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});
/** No payment keys at all, as on a fresh clone. */
const noPaymentKeys = () => {
  for (const k of [
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'SQUARE_ACCESS_TOKEN',
    'SQUARE_LOCATION_ID',
    'SQUARE_APPLICATION_ID',
  ])
    process.env[k] = '';
};
const order = async () =>
  (
    await http
      .post('/checkout/intent')
      .send({
        quote: {
          items: [{ variationId: 'PRZ1_V', quantity: 1 }],
          shippingMethod: 'standard',
          country: 'CA',
          province: 'AB',
        },
        email: 'intern@example.test',
        billing: address,
        shipping: address,
      })
      .expect(200)
  ).body;
const pay = (orderId: number, email = 'intern@example.test') =>
  http.post('/checkout/test-payment').send({ orderId, email });

describe('test payments on a local copy with no payment keys', () => {
  it('completes the order as a paid one, once, for the email on the order only', async () => {
    noPaymentKeys();
    process.env.DEV_TEST_PAYMENTS = 'true';
    expect((await http.get('/checkout/config').expect(200)).body.provider).toBe('test');
    const started = await order();
    expect(started).toMatchObject({ provider: 'test' });
    await pay(started.orderId, 'someone@else.test').expect(404);
    expect((await pay(started.orderId).expect(200)).body).toMatchObject({ status: 'paid' });
    expect((await pay(started.orderId).expect(200)).body).toMatchObject({ status: 'paid' });
  });

  it('is never used where it could be the real shop, nor when the shop has payment keys', async () => {
    noPaymentKeys();
    // not asked for (only `npm run dev:local` asks)
    delete process.env.DEV_TEST_PAYMENTS;
    expect((await http.get('/checkout/config')).body.provider).not.toBe('test');
    process.env.DEV_TEST_PAYMENTS = 'true';
    const started = await order();
    // the real shop's settings switch it off whatever DEV_TEST_PAYMENTS says
    for (const [k, v] of [
      ['NODE_ENV', 'production'],
      ['APP_ENV', 'staging'],
      ['RENDER', 'true'],
    ] as const) {
      process.env[k] = v;
      expect((await http.get('/checkout/config')).body.provider).not.toBe('test');
      await pay(started.orderId).expect(404);
      process.env[k] = saved[k] ?? '';
    }
    // a shop with PayPal (sandbox) keys uses PayPal
    process.env.PAYPAL_CLIENT_ID = 'pp-client';
    process.env.PAYPAL_CLIENT_SECRET = 'pp-secret';
    expect((await http.get('/checkout/config')).body.provider).toBe('paypal');
    await pay(started.orderId).expect(404);
  });
});
