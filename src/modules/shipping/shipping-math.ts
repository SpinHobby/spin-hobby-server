/**
 * Shipping as plain functions (no database, no network): the parcel an order makes, and the courier options a shopper sees with the shop's
 * free-shipping rule applied. shipping-rates.service.ts gets the rates; quote.service.ts uses these.
 */

/** One item's packed size: weight in grams, box in centimetres. */
export interface ParcelSize {
  weightG: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

/** The longest box side a parcel is allowed to grow to when items are stacked (beyond it, couriers charge as oversized anyway). */
const MAX_STACK_CM = 100;

/**
 * The parcel for an order: every item's weight plus the packaging, in a box as long and wide as the biggest item and as tall as the items
 * stacked (capped). An approximation on the generous side, which is what a quote should be.
 */
export function parcelFor(
  items: { size: ParcelSize; quantity: number }[],
  packagingG: number,
): ParcelSize {
  const weightG =
    items.reduce((g, i) => g + i.size.weightG * i.quantity, 0) + Math.max(0, packagingG);
  const lengthCm = Math.max(1, ...items.map((i) => i.size.lengthCm));
  const widthCm = Math.max(1, ...items.map((i) => i.size.widthCm));
  const heightCm = Math.min(
    MAX_STACK_CM,
    Math.max(
      1,
      items.reduce((h, i) => h + i.size.heightCm * i.quantity, 0),
    ),
  );
  return { weightG: Math.max(1, Math.round(weightG)), lengthCm, widthCm, heightCm };
}

/** A courier's price for the parcel, as the rates provider gave it (cents, CAD). */
export interface Rate {
  carrier: string;
  service: string;
  cents: number;
  /** Business days in transit, when the courier says. */
  days: number | null;
}

/** A choice at checkout: what the shopper pays (`cents`) and what the courier charges (`fullCents`). */
export interface ShippingOption extends Rate {
  /** Stable across quotes ("canadapost:Expedited"), so the option picked on the quote is the one paid for. */
  id: string;
  fullCents: number;
  /** Free because the goods reached the free-shipping threshold. */
  free: boolean;
}

/** At most this many options: the shopper picks between couriers and speeds, not from a wall of rates. */
const MAX_OPTIONS = 6;

export const optionId = (carrier: string, service: string) =>
  `${carrier}:${service}`.toLowerCase().replace(/[^a-z0-9:]+/g, '-');

/**
 * The options a shopper sees, cheapest first, one per carrier and service. Once the goods reach the free-shipping threshold the cheapest
 * option is free and every other one costs only what it adds on top of the cheapest.
 */
export function shippingOptions(
  rates: Rate[],
  goodsCents: number,
  freeThresholdCents: number,
): ShippingOption[] {
  const seen = new Set<string>();
  const sorted = rates
    .filter((r) => Number.isFinite(r.cents) && r.cents >= 0)
    .sort((a, b) => a.cents - b.cents || (a.days ?? 99) - (b.days ?? 99))
    .filter((r) => {
      const id = optionId(r.carrier, r.service);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_OPTIONS);
  const cheapest = sorted[0]?.cents ?? 0;
  const freeShipping = freeThresholdCents > 0 && goodsCents >= freeThresholdCents;
  return sorted.map((r) => ({
    ...r,
    id: optionId(r.carrier, r.service),
    fullCents: r.cents,
    cents: freeShipping ? r.cents - cheapest : r.cents,
    free: freeShipping && r.cents === cheapest,
  }));
}

/**
 * The option an order uses: the one the shopper picked when it is still offered; otherwise, for older websites that only say standard or
 * express, the cheapest or the fastest. Null when there are no options.
 */
export function pickOption(
  options: ShippingOption[],
  wanted: string | null | undefined,
  method: 'standard' | 'express' = 'standard',
): ShippingOption | null {
  if (!options.length) return null;
  const exact = wanted ? options.find((o) => o.id === wanted) : undefined;
  if (exact) return exact;
  if (method === 'express') {
    const fastest = [...options].sort(
      (a, b) => (a.days ?? 99) - (b.days ?? 99) || a.cents - b.cents,
    )[0];
    return fastest.id === options[0].id && options.length > 1 ? options[1] : fastest;
  }
  return options[0];
}

/** "A1A 1A1" for a Canadian postal code, five digits for a US ZIP; null when it isn't one. */
export function normalizePostal(country: 'CA' | 'US', value: unknown): string | null {
  const raw = typeof value === 'string' ? value.toUpperCase().replace(/\s+/g, '') : '';
  if (country === 'CA')
    return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(raw) ? `${raw.slice(0, 3)} ${raw.slice(3)}` : null;
  const zip = /^(\d{5})(-?\d{4})?$/.exec(raw);
  return zip ? zip[1] : null;
}
