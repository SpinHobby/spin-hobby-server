import { AppError } from '../../../common/errors.js';
import { Rule } from '../../../common/validation/decorators.js';
import { positiveInteger, stringValue } from '../../../common/validation/rules.js';
import type { QuoteInput } from '../../orders/quote.service.js';
import { normalizePostal } from '../../shipping/shipping-math.js';

export const MAX_CART_LINES = 40;
export const MAX_LINE_QUANTITY = 99;
const SHIPPING_REQUIRED = 'A shipping method, country, and province are required.';

// The cart rules as plain functions, so the /cart/quote DTO below and the checkout-intent DTO share them.

/** 1 to 40 lines; repeated variations are merged into one line and no line may exceed 99 units. */
export function cartItems(value: unknown): QuoteInput['items'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CART_LINES)
    throw new AppError(`Your cart must contain between 1 and ${MAX_CART_LINES} items.`);
  const quantities = new Map<string, number>();
  for (const line of value) {
    if (!line || typeof line !== 'object') throw new AppError('Invalid cart line.');
    const { variationId: id, quantity } = line as Record<string, unknown>;
    const variationId = stringValue(id, 'variationId', 120);
    quantities.set(
      variationId,
      (quantities.get(variationId) ?? 0) + positiveInteger(quantity, 'quantity'),
    );
  }
  for (const total of quantities.values())
    if (total > MAX_LINE_QUANTITY)
      throw new AppError(`A product quantity cannot exceed ${MAX_LINE_QUANTITY}.`);
  return [...quantities].map(([variationId, quantity]) => ({ variationId, quantity }));
}

export function shippingMethod(value: unknown): QuoteInput['shippingMethod'] {
  if (value === 'standard' || value === 'express') return value;
  throw new AppError(SHIPPING_REQUIRED);
}

export function shipToCountry(value: unknown): QuoteInput['country'] {
  if (value === 'CA' || value === 'US') return value;
  throw new AppError(SHIPPING_REQUIRED);
}

/** Province or state code, upper-cased. */
export function shipToProvince(value: unknown): string {
  const province = typeof value === 'string' ? value.toUpperCase().trim() : '';
  if (!province) throw new AppError(SHIPPING_REQUIRED);
  return province;
}

/** An optional discount code (at most 40 characters; checked when the cart is priced). */
export function discountCode(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 40)
    throw new AppError('Enter a valid discount code.');
  return value.trim() || null;
}

/** An optional short text (a courier option id, a city): at most `max` characters, else null. */
export function optionalShort(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** A whole cart request as sent by the storefront (used where the cart is nested inside another request). */
export function cartRequest(value: unknown): QuoteInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError('quoteInput is required.');
  const cart = value as Record<string, unknown>;
  return {
    items: cartItems(cart.items),
    shippingMethod: shippingMethod(cart.shippingMethod),
    country: shipToCountry(cart.country),
    province: shipToProvince(cart.province),
    discountCode: discountCode(cart.discountCode),
    ...shippingTo(cart),
  };
}

/** The postal code (normalized; a malformed one is treated as not given yet), city and courier option of a cart request. */
export function shippingTo(cart: Record<string, unknown>) {
  const country = cart.country === 'US' ? 'US' : 'CA';
  return {
    postalCode: normalizePostal(country, cart.postalCode),
    city: optionalShort(cart.city, 80),
    shippingOption: optionalShort(cart.shippingOption, 80),
  };
}

/** One line of the cart. (Describes the request in the API docs; the rules live in `cartItems`.) */
export class CartLine {
  /** The Square variation id. */
  variationId!: string;
  /** 1 to 99. */
  quantity!: number;
}

/** What `POST /cart/quote` takes: the cart plus where it is going, so shipping and tax can be priced. */
export class QuoteRequestDto implements QuoteInput {
  /** Cart lines (1 to 40). Repeated variations are merged. */
  @Rule(cartItems)
  items!: CartLine[];

  /** `standard` or `express`. */
  @Rule(shippingMethod)
  shippingMethod!: QuoteInput['shippingMethod'];

  /** `CA` or `US`. */
  @Rule(shipToCountry)
  country!: QuoteInput['country'];

  /** Province or state code, e.g. `AB`. */
  @Rule(shipToProvince)
  province!: string;

  /** A discount code, as typed (optional). */
  @Rule(discountCode)
  discountCode: string | null = null;

  /** The postal or ZIP code, for live courier rates (optional; a malformed one is ignored). */
  @Rule((v) => (typeof v === 'string' ? v.slice(0, 12) : null))
  postalCode: string | null = null;

  @Rule((v) => optionalShort(v, 80))
  city: string | null = null;

  /** The courier option picked from a quote (its id), optional. */
  @Rule((v) => optionalShort(v, 80))
  shippingOption: string | null = null;
}
