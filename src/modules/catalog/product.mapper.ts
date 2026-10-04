import type { StorefrontProductRow } from '../../database/rows.js';

/** Public product shape - identical to the edge function's publicProduct(). */
export function publicProduct(p: StorefrontProductRow) {
  return {
    id: p.id,
    variationId: p.variation_id,
    name: p.name,
    series: p.series,
    character: p.character,
    category: p.category,
    categoryId: p.category_id ?? null,
    images: p.images ?? [],
    priceCents: p.price_cents,
    compareAtCents: p.compare_at_cents,
    currency: p.currency,
    status: p.status,
    stockCount: p.stock_count,
    releaseMonth: p.release_month,
    orderByDate: p.order_by_date,
    rank: p.rank,
    maxPerCustomer: p.max_per_customer,
  };
}
export type PublicProduct = ReturnType<typeof publicProduct>;
