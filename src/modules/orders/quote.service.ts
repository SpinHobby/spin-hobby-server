import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { orderHoldMinutes } from '../../config/orders.config.js';
import { Db, type Queryable } from '../../database/db.service.js';
import { StoreService } from '../store/store.service.js';
import { applyDiscount, discountLabel } from '../discounts/discount-math.js';
import { DiscountsService } from '../discounts/discounts.service.js';
import { priceCartLine, totalsWithShipping, type QuoteRow } from './quote-math.js';
import { normalizePostal, pickOption, type ShippingOption } from '../shipping/shipping-math.js';
import { ShippingRatesService } from '../shipping/shipping-rates.service.js';

export interface QuoteInput {
  items: { variationId: string; quantity: number }[];
  shippingMethod: 'standard' | 'express';
  country: 'CA' | 'US';
  province: string;
  /** A discount code as the shopper typed it (optional). */
  discountCode?: string | null;
  /** Where it goes, for live courier rates ("T2P 1J9", "98101"); without it the flat prices are offered. */
  postalCode?: string | null;
  city?: string | null;
  /** The courier option picked from a quote's `shippingOptions` (its id); otherwise `shippingMethod` picks the cheapest or fastest. */
  shippingOption?: string | null;
}
export interface QuoteLine {
  variationId: string;
  itemId: string;
  name: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  isPreorder: boolean;
  lineCents: number;
}
export interface QuoteWarning {
  variationId: string;
  code: 'OUT_OF_STOCK' | 'QTY_REDUCED' | 'PREORDER_CLOSED' | 'LIMIT_EXCEEDED';
  message: string;
}
export interface Quote {
  lines: QuoteLine[];
  subtotalCents: number;
  /** What the discount code took off the goods (0 without one). */
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: 'CAD';
  warnings: QuoteWarning[];
  /** The code that applied, e.g. { code: 'SPRING10', label: '10% off' }; null when none was given or it can't be used. */
  discount: { code: string; label: string } | null;
  /** Why the code that was typed doesn't apply ("That code has expired."), else null. Doesn't stop checkout. */
  discountMessage: string | null;
  /** The courier options for this cart and address, cheapest first, with the free-shipping rule applied. */
  shippingOptions: ShippingOption[];
  /** The option this quote is priced with. */
  shippingOption: ShippingOption | null;
  /** True when the options are couriers' live rates, false for the shop's flat prices. */
  shippingLive: boolean;
}

/** Server-side price/stock/tax check. Never trusts prices from the browser. The rules live in quote-math.ts. */
@Injectable()
export class QuoteService {
  constructor(
    private readonly db: Db,
    private readonly store: StoreService,
    private readonly discounts: DiscountsService,
    private readonly shipping: ShippingRatesService,
  ) {}

  /**
   * Units of each variation that are spoken for but not yet reflected in its stock count:
   *  - open checkouts (pending orders inside the hold window), and
   *  - sales of Square-sourced items that Square hasn't reported back yet (paid after the stock
   *    snapshot was last synced). Hand-entered items are decremented when paid, so they never appear here.
   * `excludeOrderId` lets an order be re-checked against everyone else's holds.
   */
  async held(
    variationIds: string[],
    tx?: Queryable,
    excludeOrderId?: number,
  ): Promise<Map<string, number>> {
    if (!variationIds.length) return new Map();
    const rows = await this.db.many<{ variation_id: string; held: number }>(
      `select oi.square_variation_id as variation_id, sum(oi.quantity)::int as held
         from public.order_items oi
         join public.orders o on o.id = oi.order_id
         left join public.inventory_snapshots i on i.square_variation_id = oi.square_variation_id
         left join public.catalog_products p on p.square_item_id = oi.square_item_id
        where oi.square_variation_id = any($1::text[])
          and ($2::bigint is null or o.id <> $2::bigint)
          and (
            (o.status = 'pending' and o.created_at > now() - make_interval(mins => $3::int))
            or (o.paid_at is not null and o.status not in ('pending', 'cancelled', 'refunded')
                and coalesce(p.source, 'square') = 'square' and i.synced_at is not null and o.paid_at > i.synced_at)
          )
        group by 1`,
      [variationIds, excludeOrderId ?? null, orderHoldMinutes()],
      tx,
    );
    return new Map(rows.map((r) => [r.variation_id, Number(r.held)]));
  }

  /**
   * Fetches the courier rates for this cart now, outside any transaction, so that pricing the order inside one (with the stock locked)
   * reuses them instead of waiting on the courier. Best effort: a failure here just means the flat prices.
   */
  async warmShipping(input: QuoteInput) {
    await this.quote(input).catch(() => undefined);
  }

  async quote(
    input: QuoteInput,
    tx?: Queryable,
    options: { excludeOrderId?: number } = {},
  ): Promise<Quote> {
    const ids = input.items.map((i) => i.variationId);
    const rows = await this.db.many<QuoteRow>(
      `select v.square_variation_id, v.square_item_id, v.name as variation_name, v.price_cents, v.is_sellable,
              p.name as product_name, p.is_active, p.is_visible,
              m.availability, m.order_by_date, m.max_per_customer,
              i.quantity as stock,
              (select pi.image_url from public.product_images pi where pi.square_item_id = v.square_item_id order by pi.sort_order limit 1) as image_url
         from public.catalog_variations v
         join public.catalog_products p on p.square_item_id = v.square_item_id
         left join public.product_metadata m on m.square_item_id = v.square_item_id
         left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
        where v.square_variation_id = any($1::text[])`,
      [ids],
      tx,
    );
    if (rows.length !== ids.length)
      throw new AppError('One or more products are no longer available.');
    const held = await this.held(ids, tx, options.excludeOrderId);
    const [settings, tax] = await Promise.all([
      this.store.settings(tx),
      this.db.one<{ rate: number }>(
        'select rate from public.tax_rates where country = $1 and province = $2 and enabled',
        [input.country, input.province],
        tx,
      ),
    ]);

    const byId = new Map(rows.map((r) => [r.square_variation_id, r]));
    const lines: QuoteLine[] = [];
    const warnings: QuoteWarning[] = [];
    for (const { variationId, quantity } of input.items) {
      const priced = priceCartLine(byId.get(variationId)!, quantity, held.get(variationId) ?? 0);
      warnings.push(...priced.warnings);
      if (priced.line) lines.push(priced.line);
    }
    const subtotal = lines.reduce((sum, l) => sum + l.lineCents, 0);
    const typed = input.discountCode?.trim();
    const rule = typed ? await this.discounts.find(typed, tx) : null;
    const applied = typed ? applyDiscount(rule, subtotal) : null;
    const discount =
      rule && applied && !applied.message ? { code: rule.code, label: discountLabel(rule) } : null;
    const discountCents = discount ? applied!.cents : 0;
    // courier options for what can be bought (not lines that dropped out), priced with the free-shipping rule on the discounted goods
    const shipping = await this.shipping.options(
      {
        country: input.country,
        province: input.province,
        postalCode: normalizePostal(input.country, input.postalCode),
        city: input.city ?? null,
        items: lines.map((l) => ({ variationId: l.variationId, quantity: l.quantity })),
      },
      settings,
      Math.max(0, subtotal - Math.min(discountCents, subtotal)),
      tx,
    );
    const chosen = pickOption(shipping.options, input.shippingOption, input.shippingMethod);
    return {
      lines,
      ...totalsWithShipping(lines, chosen?.cents ?? 0, Number(tax?.rate ?? 0), discountCents),
      currency: 'CAD',
      warnings,
      discount,
      discountMessage: applied?.message ?? null,
      shippingOptions: shipping.options,
      shippingOption: chosen,
      shippingLive: shipping.live,
    };
  }
}
