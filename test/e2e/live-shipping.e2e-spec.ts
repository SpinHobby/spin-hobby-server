import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, pglite } = shop;

/** What EasyPost answers: three couriers, plus a USD rate that must be ignored. */
const RATES = {
  rates: [
    {
      carrier: 'CanadaPost',
      service: 'RegularParcel',
      rate: '14.20',
      currency: 'CAD',
      delivery_days: 6,
    },
    {
      carrier: 'CanadaPost',
      service: 'ExpeditedParcel',
      rate: '16.80',
      currency: 'CAD',
      delivery_days: 3,
    },
    {
      carrier: 'CanadaPost',
      service: 'Xpresspost',
      rate: '24.10',
      currency: 'CAD',
      delivery_days: 1,
    },
    { carrier: 'UPS', service: 'UPSStandard', rate: '18.95', currency: 'CAD', delivery_days: 4 },
    {
      carrier: 'Purolator',
      service: 'PurolatorGround',
      rate: '15.40',
      currency: 'CAD',
      est_delivery_days: 5,
    },
    { carrier: 'USPS', service: 'Priority', rate: '30.00', currency: 'USD', delivery_days: 3 },
  ],
};

const quote = (
  extra: Record<string, unknown> = {},
  items = [{ variationId: 'PRZ1_V', quantity: 1 }],
) =>
  http
    .post('/cart/quote')
    .send({ items, shippingMethod: 'standard', country: 'CA', province: 'AB', ...extra });

beforeAll(async () => {
  process.env.EASYPOST_API_KEY = 'EZTK_test';
  await http
    .put('/admin/settings')
    .set('Authorization', owner.auth)
    .send({
      ship_from_postal: 't2p1j9',
      ship_from_city: 'Calgary',
      ship_from_province: 'ab',
      packaging_weight_g: 200,
    })
    .expect(200);
});
afterAll(() => {
  delete process.env.EASYPOST_API_KEY;
});

describe('live courier rates (EasyPost)', () => {
  it('offers each courier for the parcel, cheapest first, with the delivery days', async () => {
    const easypost = mockFetch({ 'api.easypost.com': () => RATES });
    try {
      const res = await quote({ postalCode: 'm5v 3l9', city: 'Toronto', province: 'ON' }).expect(
        200,
      );
      expect(res.body.shippingLive).toBe(true);
      expect(
        res.body.shippingOptions.map(
          (o: { carrier: string; service: string; cents: number; days: number }) => [
            o.carrier,
            o.service,
            o.cents,
            o.days,
          ],
        ),
      ).toEqual([
        ['Canada Post', 'Regular Parcel', 1420, 6],
        ['Purolator', 'Ground', 1540, 5],
        ['Canada Post', 'Expedited Parcel', 1680, 3],
        ['UPS', 'Standard', 1895, 4],
        ['Canada Post', 'Xpresspost', 2410, 1],
      ]);
      expect(res.body).toMatchObject({
        shippingCents: 1420,
        shippingOption: { id: 'canada-post:regular-parcel' },
      });
      expect(res.body.taxCents).toBe(Math.round((3900 + 1420) * 0.13));

      // the request: from the shop's postal code, to the shopper's, the parcel in ounces and inches (the shop default 500 g + 200 g packing)
      const sent = easypost.calls[0].body.shipment;
      expect(sent.from_address).toMatchObject({
        zip: 'T2P 1J9',
        state: 'AB',
        country: 'CA',
        city: 'Calgary',
      });
      expect(sent.to_address).toMatchObject({ zip: 'M5V 3L9', state: 'ON', country: 'CA' });
      expect(sent.parcel.weight).toBeCloseTo(700 * 0.035274, 0);
      expect(sent.parcel.length).toBeCloseTo(30 * 0.3937, 0);

      // the same cart and address again: no second request to EasyPost (cached)
      const picked = await quote({
        postalCode: 'M5V3L9',
        province: 'ON',
        shippingOption: 'canada-post:xpresspost',
      }).expect(200);
      expect(picked.body.shippingCents).toBe(2410);
      expect(easypost.calls).toHaveLength(1);
    } finally {
      easypost.restore();
    }
  });

  it('makes the cheapest courier free over the threshold, and charges only the difference for faster ones', async () => {
    const easypost = mockFetch({ 'api.easypost.com': () => RATES });
    try {
      const res = await quote(
        { postalCode: 'V6B 1A1', province: 'BC', shippingOption: 'canada-post:expedited-parcel' },
        [{ variationId: 'PRZ1_V', quantity: 2 }],
      ).expect(200);
      expect(res.body.shippingOptions[0]).toMatchObject({
        id: 'canada-post:regular-parcel',
        cents: 0,
        free: true,
        fullCents: 1420,
      });
      expect(res.body.shippingCents).toBe(1680 - 1420);
    } finally {
      easypost.restore();
    }
  });

  it('weighs by the category, then the product, and stacks quantities', async () => {
    const cat = (
      await pglite.query<{ id: string }>(
        "insert into public.store_categories (name, parcel_weight_g, parcel_height_cm) values ('Heavy Things', 2000, 40) returning id",
      )
    ).rows[0].id;
    await http
      .patch('/admin/products/PRZ1')
      .set('Authorization', owner.auth)
      .send({ category_id: cat })
      .expect(200);
    const easypost = mockFetch({ 'api.easypost.com': () => RATES });
    try {
      await quote({ postalCode: 'H2X 1Y4', province: 'QC' }, [
        { variationId: 'PRZ1_V', quantity: 2 },
      ]).expect(200);
      let parcel = easypost.calls.at(-1)!.body.shipment.parcel;
      expect(parcel.weight).toBeCloseTo((2 * 2000 + 200) * 0.035274, 0);
      expect(parcel.height).toBeCloseTo(80 * 0.3937, 0); // two 40 cm boxes stacked

      // the product's own size beats its category's
      await http
        .patch('/admin/products/PRZ1')
        .set('Authorization', owner.auth)
        .send({ parcel_weight_g: 300 })
        .expect(200);
      await quote({ postalCode: 'H2X 1Y4', province: 'QC' }).expect(200);
      parcel = easypost.calls.at(-1)!.body.shipment.parcel;
      expect(parcel.weight).toBeCloseTo((300 + 200) * 0.035274, 0);
    } finally {
      easypost.restore();
    }
  });

  it('falls back to the flat prices without a postal code, or when EasyPost fails', async () => {
    const noPostal = await quote().expect(200);
    expect(noPostal.body.shippingLive).toBe(false);
    expect(noPostal.body.shippingCents).toBe(899);

    const down = mockFetch({ 'api.easypost.com': () => new Response('{}', { status: 500 }) });
    try {
      const res = await quote({ postalCode: 'R3C 4T3', province: 'MB' }).expect(200);
      expect(res.body.shippingLive).toBe(false);
      expect(res.body.shippingOptions.map((o: { id: string }) => o.id)).toEqual([
        'spin-hobby:standard',
        'spin-hobby:express',
      ]);
    } finally {
      down.restore();
    }
  });

  it('saves the courier on the order, and asks again when the picked option is gone', async () => {
    const services = mockFetch({
      'api.easypost.com': () => RATES,
      '/v1/oauth2/token': () => ({ access_token: 'tok' }),
      '/v2/checkout/orders': () => ({ id: 'PP-SHIP' }),
    });
    const intent = (shippingOption: string) =>
      http.post('/checkout/intent').send({
        quote: {
          items: [{ variationId: 'CHB1_V', quantity: 1 }],
          shippingMethod: 'standard',
          country: 'CA',
          province: 'AB',
          shippingOption,
        },
        email: 'courier@example.com',
        billing: address,
        shipping: address, // Edmonton, T5J 0N3
      });
    try {
      const ok = await intent('ups:standard').expect(200);
      const order = await pglite.query<{
        shipping_carrier: string;
        shipping_service: string;
        shipping_days: number;
        shipping_cents: number;
        shipping_method: string;
      }>(
        'select shipping_carrier, shipping_service, shipping_days, shipping_cents, shipping_method from public.orders where id = $1',
        [ok.body.orderId],
      );
      expect(order.rows[0]).toEqual({
        shipping_carrier: 'UPS',
        shipping_service: 'Standard',
        shipping_days: 4,
        shipping_cents: 1895,
        shipping_method: 'express',
      });
      const to = services.calls.find(
        (c) => c.url.includes('easypost') && c.body.shipment.to_address.zip === 'T5J 0N3',
      );
      expect(to).toBeTruthy(); // priced to the address being paid for

      const gone = await intent('fedex:overnight').expect(409);
      expect(gone.body.code ?? gone.body.error).toBeTruthy();
    } finally {
      services.restore();
    }
  });
});
