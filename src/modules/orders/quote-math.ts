import type {
  CatalogProductRow,
  CatalogVariationRow,
  InventorySnapshotRow,
  ProductMetadataRow,
  StoreSettingsRow,
} from '../../database/rows.js';
import type { QuoteLine, QuoteWarning } from './quote.service.js';

/**
 * The pricing rules, kept free of the database so they can be tested on their own. `QuoteService` loads
 * the rows and the holds, then calls these.
 */

/** What the quote query selects: a variation with its product, availability rules and stock. */
export type QuoteRow = Pick<
  CatalogVariationRow,
  'square_variation_id' | 'square_item_id' | 'price_cents' | 'is_sellable'
> &
  Pick<CatalogProductRow, 'is_active' | 'is_visible'> &
  Pick<ProductMetadataRow, 'availability' | 'order_by_date' | 'max_per_customer'> & {
    variation_name: string | null;
    product_name: string;
    stock: InventorySnapshotRow['quantity'];
    image_url: string | null;
  };

/**
 * Decides what one cart line becomes: a priced line, a warning explaining why it can't be sold, or both
 * (e.g. "only 2 can be added" plus the 2 that can).
 *
 * @param requested how many the shopper asked for
 * @param held units of this variation already spoken for by other open checkouts
 * @param now the current time in ms (a parameter so tests can fix it)
 */
export function priceCartLine(
  v: QuoteRow,
  requested: number,
  held: number,
  now = Date.now(),
): { line: QuoteLine | null; warnings: QuoteWarning[] } {
  const variationId = v.square_variation_id;
  const name = v.product_name;
  const warnings: QuoteWarning[] = [];
  const preorder = v.availability === 'preorder' || v.availability === 'backorder';
  const closed = preorder && v.order_by_date && new Date(v.order_by_date).getTime() < now;

  if (!v.is_active || !v.is_visible || v.availability === 'hidden' || !v.is_sellable) {
    warnings.push({
      variationId,
      code: 'OUT_OF_STOCK',
      message: `${v.variation_name ?? name ?? 'This item'} is unavailable.`,
    });
    return { line: null, warnings };
  }
  // No price (Square's "variable price" items come through as 0, priced at the till): never sold online for nothing
  if (!(Number(v.price_cents) > 0)) {
    warnings.push({
      variationId,
      code: 'NO_PRICE',
      message: `${name} has no online price yet. Contact us to buy it.`,
    });
    return { line: null, warnings };
  }
  if (closed) {
    warnings.push({
      variationId,
      code: 'PREORDER_CLOSED',
      message: `${name} is no longer accepting pre-orders.`,
    });
    return { line: null, warnings };
  }

  // A variation Square doesn't track (no stock count) is never limited by stock; pre-orders aren't either.
  const stockLeft =
    v.stock === null || v.stock === undefined ? null : Math.max(0, Number(v.stock) - held);
  const available = preorder || stockLeft === null ? requested : Math.min(requested, stockLeft);
  if (available < requested) {
    warnings.push({
      variationId,
      code: available ? 'QTY_REDUCED' : 'OUT_OF_STOCK',
      message: available ? `Only ${available} of ${name} can be added.` : `${name} is sold out.`,
    });
  }
  if (!available) return { line: null, warnings };
  if (v.max_per_customer && available > v.max_per_customer) {
    warnings.push({
      variationId,
      code: 'LIMIT_EXCEEDED',
      message: `${name} is limited to ${v.max_per_customer} per customer.`,
    });
    return { line: null, warnings };
  }

  const unit = Number(v.price_cents);
  return {
    line: {
      variationId,
      itemId: v.square_item_id,
      name,
      imageUrl: v.image_url ?? null,
      unitPriceCents: unit,
      quantity: available,
      isPreorder: preorder,
      lineCents: unit * available,
    },
    warnings,
  };
}

/**
 * Subtotal, discount, shipping, tax and total for the priced lines, all in whole cents.
 * `discountCents` (a discount code's amount, worked out by applyDiscount) comes off the goods.
 * Express shipping is a flat rate. Standard shipping is free once the goods, after the discount, reach the free-shipping threshold.
 * Tax is charged on the discounted goods plus shipping at the province's rate (e.g. 0.05 for 5%), rounded to the cent.
 */
export function cartTotals(
  lines: Pick<QuoteLine, 'lineCents'>[],
  shippingMethod: 'standard' | 'express',
  settings: Pick<
    StoreSettingsRow,
    'shipping_express_cents' | 'shipping_standard_cents' | 'free_shipping_threshold_cents'
  >,
  taxRate: number,
  discountCents = 0,
) {
  const subtotalCents = lines.reduce((total, l) => total + l.lineCents, 0);
  const discount = Math.min(Math.max(0, discountCents), subtotalCents);
  const goods = subtotalCents - discount;
  const shippingCents =
    shippingMethod === 'express'
      ? Number(settings.shipping_express_cents)
      : goods >= Number(settings.free_shipping_threshold_cents)
        ? 0
        : Number(settings.shipping_standard_cents);
  return totalsWithShipping(lines, shippingCents, taxRate, discountCents);
}

/** The same totals for a shipping price already chosen (a courier option from shipping-rates.service.ts). */
export function totalsWithShipping(
  lines: Pick<QuoteLine, 'lineCents'>[],
  shippingCents: number,
  taxRate: number,
  discountCents = 0,
) {
  const subtotalCents = lines.reduce((total, l) => total + l.lineCents, 0);
  const discount = Math.min(Math.max(0, discountCents), subtotalCents);
  const goods = subtotalCents - discount;
  const shipping = Math.max(0, Math.round(shippingCents));
  const taxCents = Math.round((goods + shipping) * taxRate);
  return {
    subtotalCents,
    discountCents: discount,
    shippingCents: shipping,
    taxCents,
    totalCents: goods + shipping + taxCents,
  };
}
