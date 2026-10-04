import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { packingSlipHtml } from '../packing-slip.js';
import { AdminOrdersQuery, RefundOrderDto, ShipOrderDto } from './orders.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

describe('ShipOrderDto', () => {
  it('needs a tracking number; the carrier is optional', async () => {
    expect(await body(ShipOrderDto, { trackingNumber: ' CA123 ' })).toMatchObject({
      trackingNumber: 'CA123',
      carrier: null,
    });
    expect(
      await body(ShipOrderDto, { trackingNumber: 'CA123', carrier: 'Canada Post' }),
    ).toMatchObject({ carrier: 'Canada Post' });
    await expect(body(ShipOrderDto, {})).rejects.toMatchObject({
      message: 'trackingNumber is required.',
    });
  });
});

describe('RefundOrderDto', () => {
  it('accepts no body at all, meaning refund everything', async () => {
    expect(await body(RefundOrderDto, undefined)).toMatchObject({});
    expect(await body(RefundOrderDto, null)).toMatchObject({});
    expect(((await body(RefundOrderDto, {})) as RefundOrderDto).amountCents).toBeUndefined();
  });

  it('passes a partial amount through for the service to check against the order total', async () => {
    expect(await body(RefundOrderDto, { amountCents: 500 })).toMatchObject({ amountCents: 500 });
  });

  it('still refuses a body that is not an object', async () => {
    await expect(body(RefundOrderDto, 'x')).rejects.toMatchObject({
      message: 'Expected a JSON object.',
    });
  });

  it('other DTOs still refuse a missing body', async () => {
    await expect(body(ShipOrderDto, undefined)).rejects.toMatchObject({
      message: 'Expected a JSON object.',
    });
  });
});

describe('AdminOrdersQuery', () => {
  it('keeps both filters', async () => {
    const query = await pipe.transform(
      { status: 'paid', limit: '10', junk: 1 },
      { type: 'query', metatype: AdminOrdersQuery },
    );
    expect({ ...(query as object) }).toEqual({ status: 'paid', limit: '10' });
  });
});

describe('packingSlipHtml', () => {
  const order = {
    id: 42,
    shipping_address: {
      firstName: 'Aki',
      lastName: '<b>Tanaka</b>',
      address1: '10 Jasper Ave',
      city: 'Edmonton',
      province: 'AB',
      postalCode: 'T5J 0N3',
    },
    order_items: [{ name: 'Rem <script>x</script> Figure', quantity: 2 }],
  };

  it('lists who to ship to and what goes in the box', () => {
    const html = packingSlipHtml(order);
    expect(html).toContain('Packing slip #42');
    expect(html).toContain('Aki');
    expect(html).toContain('10 Jasper Ave');
    expect(html).toContain('Edmonton, AB T5J 0N3');
    expect(html).toContain('<td>2</td>');
  });

  it('escapes anything a customer typed', () => {
    const html = packingSlipHtml(order);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Tanaka</b>');
    expect(html).toContain('Rem &lt;script&gt;x&lt;/script&gt; Figure');
  });

  it('copes with an order that has no address or items', () => {
    expect(() => packingSlipHtml({ id: 1 })).not.toThrow();
  });
});
