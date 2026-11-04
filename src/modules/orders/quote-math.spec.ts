import { describe, expect, it } from 'vitest';
import { cartTotals, priceCartLine, type QuoteRow } from './quote-math.js';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const DAY = 86_400_000;

/** A normal, in-stock, visible product (3 in stock, $39.00); tests override what they care about. */
const row = (overrides: Partial<QuoteRow> = {}): QuoteRow => ({
  square_variation_id: 'VAR1',
  square_item_id: 'ITEM1',
  price_cents: 3900,
  is_sellable: true,
  is_active: true,
  is_visible: true,
  availability: 'auto',
  order_by_date: null,
  max_per_customer: null,
  variation_name: 'Regular',
  product_name: 'Rem figure',
  stock: 3,
  image_url: 'https://img/rem.jpg',
  ...overrides,
});
const price = (v: QuoteRow, requested: number, held = 0) => priceCartLine(v, requested, held, NOW);

describe('priceCartLine: normal items', () => {
  it('never sells an item with no price (Square variable price comes through as 0)', () => {
    for (const price_cents of [0, -1]) {
      const r = price(row({ price_cents }), 1);
      expect(r.line).toBeNull();
      expect(r.warnings).toEqual([
        {
          variationId: 'VAR1',
          code: 'NO_PRICE',
          message: 'Rem figure has no online price yet. Contact us to buy it.',
        },
      ]);
    }
  });

  it('prices the requested quantity from the database price, in whole cents', () => {
    expect(price(row(), 2)).toEqual({
      line: {
        variationId: 'VAR1',
        itemId: 'ITEM1',
        name: 'Rem figure',
        imageUrl: 'https://img/rem.jpg',
        unitPriceCents: 3900,
        quantity: 2,
        isPreorder: false,
        lineCents: 7800,
      },
      warnings: [],
    });
  });

  it('has no image when the product has none', () => {
    expect(price(row({ image_url: null }), 1).line?.imageUrl).toBeNull();
  });
});

describe('priceCartLine: stock and holds', () => {
  it('reduces the quantity to what is left and says so', () => {
    const { line, warnings } = price(row({ stock: 3 }), 5);
    expect(line?.quantity).toBe(3);
    expect(warnings).toEqual([
      { variationId: 'VAR1', code: 'QTY_REDUCED', message: 'Only 3 of Rem figure can be added.' },
    ]);
  });

  it("subtracts other shoppers' holds from the stock", () => {
    const { line, warnings } = price(row({ stock: 3 }), 3, 2);
    expect(line?.quantity).toBe(1);
    expect(warnings[0]).toMatchObject({
      code: 'QTY_REDUCED',
      message: 'Only 1 of Rem figure can be added.',
    });
  });

  it('reports sold out, with no line, when nothing is left', () => {
    const { line, warnings } = price(row({ stock: 2 }), 1, 2);
    expect(line).toBeNull();
    expect(warnings).toEqual([
      { variationId: 'VAR1', code: 'OUT_OF_STOCK', message: 'Rem figure is sold out.' },
    ]);
  });

  it('never goes negative when holds exceed the count (e.g. a sale Square has not reported yet)', () => {
    expect(price(row({ stock: 1 }), 1, 5).warnings[0].code).toBe('OUT_OF_STOCK');
  });

  it('treats a variation without a stock count as unlimited, not as zero', () => {
    const { line, warnings } = price(row({ stock: null }), 50);
    expect(line?.quantity).toBe(50);
    expect(warnings).toEqual([]);
  });

  it('sells a zero-stock variation as sold out', () => {
    expect(price(row({ stock: 0 }), 1).warnings[0].code).toBe('OUT_OF_STOCK');
  });
});

describe('priceCartLine: availability', () => {
  it.each([
    ['inactive', { is_active: false }],
    ['not visible', { is_visible: false }],
    ['hidden by staff', { availability: 'hidden' as const }],
    ['not sellable', { is_sellable: false }],
  ])('refuses an item that is %s', (_label, change) => {
    const { line, warnings } = price(row(change), 1);
    expect(line).toBeNull();
    expect(warnings).toEqual([
      { variationId: 'VAR1', code: 'OUT_OF_STOCK', message: 'Regular is unavailable.' },
    ]);
  });

  it('names the product when the variation has no name', () => {
    expect(price(row({ is_active: false, variation_name: null }), 1).warnings[0].message).toBe(
      'Rem figure is unavailable.',
    );
  });
});

describe('priceCartLine: pre-orders', () => {
  const open = new Date(NOW + 5 * DAY).toISOString();
  const closed = new Date(NOW - 1 * DAY).toISOString();

  it.each(['preorder', 'backorder'] as const)(
    'lets a %s be bought regardless of stock',
    (availability) => {
      const { line, warnings } = price(row({ availability, order_by_date: open, stock: 0 }), 4);
      expect(line).toMatchObject({ quantity: 4, isPreorder: true });
      expect(warnings).toEqual([]);
    },
  );

  it('refuses a pre-order whose cutoff date has passed', () => {
    const { line, warnings } = price(row({ availability: 'preorder', order_by_date: closed }), 1);
    expect(line).toBeNull();
    expect(warnings).toEqual([
      {
        variationId: 'VAR1',
        code: 'PREORDER_CLOSED',
        message: 'Rem figure is no longer accepting pre-orders.',
      },
    ]);
  });

  it('keeps a pre-order with no cutoff date open', () => {
    expect(price(row({ availability: 'preorder', order_by_date: null }), 1).line).not.toBeNull();
  });
});

describe('priceCartLine: per-customer limit', () => {
  it('refuses a quantity above the limit', () => {
    const { line, warnings } = price(row({ max_per_customer: 1, stock: 5 }), 2);
    expect(line).toBeNull();
    expect(warnings).toEqual([
      {
        variationId: 'VAR1',
        code: 'LIMIT_EXCEEDED',
        message: 'Rem figure is limited to 1 per customer.',
      },
    ]);
  });

  it('allows a quantity exactly at the limit', () => {
    expect(price(row({ max_per_customer: 2, stock: 5 }), 2).line?.quantity).toBe(2);
  });

  it('checks the limit against the reduced quantity, and reports both problems', () => {
    // asked for 5, only 3 in stock, limit 2: reduced to 3, then over the limit
    const { line, warnings } = price(row({ stock: 3, max_per_customer: 2 }), 5);
    expect(line).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['QTY_REDUCED', 'LIMIT_EXCEEDED']);
  });
});

describe('cartTotals', () => {
  const settings = {
    shipping_standard_cents: 899,
    shipping_express_cents: 1999,
    free_shipping_threshold_cents: 7500,
  };
  const lines = (...cents: number[]) => cents.map((lineCents) => ({ lineCents }));

  it('adds standard shipping below the free-shipping threshold, and tax on goods plus shipping', () => {
    // 3900 + 899 = 4799; 5% tax = 239.95 -> 240
    expect(cartTotals(lines(3900), 'standard', settings, 0.05)).toEqual({
      subtotalCents: 3900,
      discountCents: 0,
      shippingCents: 899,
      taxCents: 240,
      totalCents: 3900 + 899 + 240,
    });
  });

  it('makes standard shipping free at exactly the threshold', () => {
    expect(cartTotals(lines(7500), 'standard', settings, 0).shippingCents).toBe(0);
    expect(cartTotals(lines(7499), 'standard', settings, 0).shippingCents).toBe(899);
  });

  it('charges the flat express rate even above the threshold', () => {
    expect(cartTotals(lines(20000), 'express', settings, 0).shippingCents).toBe(1999);
  });

  it('sums several lines', () => {
    expect(cartTotals(lines(1800, 3900, 2200), 'standard', settings, 0).subtotalCents).toBe(7900);
  });

  it('charges no tax when the province has no rate', () => {
    expect(cartTotals(lines(3900), 'standard', settings, 0).taxCents).toBe(0);
  });

  it('rounds tax to the nearest cent (half up)', () => {
    // (1000 + 899) * 0.075 = 142.425 -> 142
    expect(cartTotals(lines(1000), 'standard', settings, 0.075).taxCents).toBe(142);
    // (7500 + 0) * 0.13 = 975 exactly
    expect(cartTotals(lines(7500), 'standard', settings, 0.13).taxCents).toBe(975);
  });

  it('prices an empty cart as just shipping', () => {
    expect(cartTotals([], 'standard', settings, 0)).toEqual({
      subtotalCents: 0,
      discountCents: 0,
      shippingCents: 899,
      taxCents: 0,
      totalCents: 899,
    });
  });

  it('takes a discount off the goods before tax, and judges free shipping after it', () => {
    // 8000 - 1000 = 7000: under the 7500 threshold, so standard shipping applies; tax on 7000 + 899 at 5% = 394.95 -> 395
    expect(cartTotals(lines(8000), 'standard', settings, 0.05, 1000)).toEqual({
      subtotalCents: 8000,
      discountCents: 1000,
      shippingCents: 899,
      taxCents: 395,
      totalCents: 7000 + 899 + 395,
    });
  });

  it('never discounts more than the goods', () => {
    const t = cartTotals(lines(500), 'express', settings, 0, 9999);
    expect(t.discountCents).toBe(500);
    expect(t.totalCents).toBe(1999);
  });

  it('accepts numeric strings from the database', () => {
    const fromDb = {
      shipping_standard_cents: '899',
      shipping_express_cents: '1999',
      free_shipping_threshold_cents: '7500',
    };
    expect(cartTotals(lines(3900), 'standard', fromDb as never, 0).shippingCents).toBe(899);
  });
});
