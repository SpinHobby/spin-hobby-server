import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { CheckoutIntentDto } from './checkout-intent.dto.js';
import { PayPalCaptureDto } from './paypal-capture.dto.js';
import { QuoteRequestDto } from './quote-request.dto.js';
import { SquarePaymentDto } from './square-payment.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

const cart = {
  items: [{ variationId: 'V1', quantity: 2 }],
  shippingMethod: 'standard',
  country: 'CA',
  province: ' ab ',
};

describe('QuoteRequestDto', () => {
  it('cleans the province and keeps the lines', async () => {
    expect(await body(QuoteRequestDto, cart)).toMatchObject({
      items: [{ variationId: 'V1', quantity: 2 }],
      shippingMethod: 'standard',
      country: 'CA',
      province: 'AB',
    });
  });

  it('merges repeated variations into one line', async () => {
    const dto = (await body(QuoteRequestDto, {
      ...cart,
      items: [
        { variationId: 'V1', quantity: 2 },
        { variationId: 'V2', quantity: 1 },
        { variationId: 'V1', quantity: '3' },
      ],
    })) as QuoteRequestDto;
    expect(dto.items).toEqual([
      { variationId: 'V1', quantity: 5 },
      { variationId: 'V2', quantity: 1 },
    ]);
  });

  it.each([
    [{ ...cart, items: [] }, 'Your cart must contain between 1 and 40 items.'],
    [{ ...cart, items: 'nope' }, 'Your cart must contain between 1 and 40 items.'],
    [
      {
        ...cart,
        items: Array.from({ length: 41 }, (_, i) => ({ variationId: `V${i}`, quantity: 1 })),
      },
      'Your cart must contain between 1 and 40 items.',
    ],
    [{ ...cart, items: [null] }, 'Invalid cart line.'],
    [{ ...cart, items: [{ quantity: 1 }] }, 'variationId is required.'],
    [
      { ...cart, items: [{ variationId: 'V1', quantity: 100 }] },
      'quantity must be between 1 and 99.',
    ],
    [
      {
        ...cart,
        items: [
          { variationId: 'V1', quantity: 60 },
          { variationId: 'V1', quantity: 60 },
        ],
      },
      'A product quantity cannot exceed 99.',
    ],
    [
      { ...cart, shippingMethod: 'pigeon' },
      'A shipping method, country, and province are required.',
    ],
    [{ ...cart, country: 'MX' }, 'A shipping method, country, and province are required.'],
    [{ ...cart, province: '  ' }, 'A shipping method, country, and province are required.'],
  ])('rejects %j', async (input, message) => {
    await expect(body(QuoteRequestDto, input)).rejects.toMatchObject({ message, status: 400 });
  });
});

describe('CheckoutIntentDto', () => {
  const buyer = {
    email: ' Fan@Example.com ',
    billing: { city: 'Edmonton' },
    shipping: { city: 'Calgary' },
  };

  it('takes the cart under `quote`', async () => {
    const dto = (await body(CheckoutIntentDto, { ...buyer, quote: cart })) as CheckoutIntentDto;
    expect(dto.quote).toMatchObject({
      province: 'AB',
      items: [{ variationId: 'V1', quantity: 2 }],
    });
    expect(dto).toMatchObject({
      email: 'fan@example.com',
      billing: { city: 'Edmonton' },
      shipping: { city: 'Calgary' },
    });
  });

  it('still accepts the older name `quoteInput`, which wins if both are sent', async () => {
    const older = { ...cart, province: 'bc' };
    expect(
      ((await body(CheckoutIntentDto, { ...buyer, quoteInput: older })) as CheckoutIntentDto).quote
        .province,
    ).toBe('BC');
    expect(
      (
        (await body(CheckoutIntentDto, {
          ...buyer,
          quote: cart,
          quoteInput: older,
        })) as CheckoutIntentDto
      ).quote.province,
    ).toBe('BC');
  });

  it('reports what is wrong with a cart sent under the older name', async () => {
    await expect(
      body(CheckoutIntentDto, { ...buyer, quoteInput: { ...cart, items: [] } }),
    ).rejects.toMatchObject({
      message: 'Your cart must contain between 1 and 40 items.',
    });
  });

  it.each([undefined, null, 'cart', ['x']])('needs a cart object (got %j)', async (quote) => {
    await expect(body(CheckoutIntentDto, { ...buyer, quote })).rejects.toMatchObject({
      message: 'quoteInput is required.',
    });
  });

  it('needs a valid email and both addresses', async () => {
    await expect(
      body(CheckoutIntentDto, { ...buyer, quote: cart, email: 'nope' }),
    ).rejects.toMatchObject({
      message: 'Enter a valid email address.',
    });
    for (const missing of ['billing', 'shipping']) {
      await expect(
        body(CheckoutIntentDto, { ...buyer, quote: cart, [missing]: undefined }),
      ).rejects.toMatchObject({
        message: 'Billing and shipping addresses are required.',
      });
    }
  });
});

describe('payment DTOs', () => {
  it('PayPalCaptureDto needs the PayPal order id', async () => {
    expect(await body(PayPalCaptureDto, { paypalOrderId: 'PP-1' })).toMatchObject({
      paypalOrderId: 'PP-1',
    });
    await expect(body(PayPalCaptureDto, {})).rejects.toMatchObject({
      message: 'paypalOrderId is required.',
    });
  });

  it('SquarePaymentDto cleans the email and treats a non-text verification token as absent', async () => {
    const ok = { orderId: '17', sourceId: 'cnon:ok', email: ' Fan@Example.com ' };
    expect(await body(SquarePaymentDto, { ...ok, verificationToken: 'tok' })).toMatchObject({
      orderId: 17,
      email: 'fan@example.com',
      verificationToken: 'tok',
    });
    expect(
      ((await body(SquarePaymentDto, { ...ok, verificationToken: 5 })) as SquarePaymentDto)
        .verificationToken,
    ).toBeUndefined();
    await expect(body(SquarePaymentDto, { ...ok, orderId: 0 })).rejects.toMatchObject({
      message: 'orderId must be between 1 and 9007199254740991.',
    });
    await expect(body(SquarePaymentDto, { ...ok, sourceId: '' })).rejects.toMatchObject({
      message: 'sourceId is required.',
    });
  });
});
