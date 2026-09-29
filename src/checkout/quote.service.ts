import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { positiveInteger, stringValue, type Json } from '../common/validation.js';
import { Db, type Queryable, type Row } from '../db/db.service.js';
import { StoreService } from '../store/store.service.js';

export interface QuoteInput { items: { variationId: string; quantity: number }[]; shippingMethod: 'standard' | 'express'; country: 'CA' | 'US'; province: string }
export interface QuoteLine { variationId: string; itemId: string; name: string; imageUrl: string | null; unitPriceCents: number; quantity: number; isPreorder: boolean; lineCents: number }
export interface QuoteWarning { variationId: string; code: 'OUT_OF_STOCK' | 'QTY_REDUCED' | 'PREORDER_CLOSED' | 'LIMIT_EXCEEDED'; message: string }
export interface Quote { lines: QuoteLine[]; subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; currency: 'CAD'; warnings: QuoteWarning[] }

export function parseQuoteInput(input: Json): QuoteInput {
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 40) throw new AppError('Your cart must contain between 1 and 40 items.');
  const shippingMethod = input.shippingMethod === 'express' || input.shippingMethod === 'standard' ? input.shippingMethod : null;
  const country = input.country === 'CA' || input.country === 'US' ? input.country : null;
  const province = typeof input.province === 'string' ? input.province.toUpperCase().trim() : '';
  if (!shippingMethod || !country || !province) throw new AppError('A shipping method, country, and province are required.');
  const quantities = new Map<string, number>();
  for (const line of input.items) {
    if (!line || typeof line !== 'object') throw new AppError('Invalid cart line.');
    const value = line as Json;
    const variationId = stringValue(value.variationId, 'variationId', 120);
    quantities.set(variationId, (quantities.get(variationId) ?? 0) + positiveInteger(value.quantity, 'quantity'));
  }
  for (const q of quantities.values()) if (q > 99) throw new AppError('A product quantity cannot exceed 99.');
  return { items: [...quantities].map(([variationId, quantity]) => ({ variationId, quantity })), shippingMethod, country, province };
}

/** Server-side price/stock/tax check. Never trusts prices from the browser. */
@Injectable()
export class QuoteService {
  constructor(private readonly db: Db, private readonly store: StoreService) {}

  async quote(input: QuoteInput, tx?: Queryable): Promise<Quote> {
    const ids = input.items.map((i) => i.variationId);
    const rows = await this.db.many<Row>(
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
      [ids], tx,
    );
    if (rows.length !== ids.length) throw new AppError('One or more products are no longer available.');
    const [settings, tax] = await Promise.all([
      this.store.settings(tx),
      this.db.one<{ rate: number }>('select rate from public.tax_rates where country = $1 and province = $2 and enabled', [input.country, input.province], tx),
    ]);

    const byId = new Map(rows.map((r) => [r.square_variation_id, r]));
    const lines: QuoteLine[] = [];
    const warnings: QuoteWarning[] = [];
    for (const { variationId, quantity: requested } of input.items) {
      const v = byId.get(variationId)!;
      const name = v.product_name as string;
      const preorder = v.availability === 'preorder' || v.availability === 'backorder';
      const closed = preorder && v.order_by_date && new Date(v.order_by_date).getTime() < Date.now();
      if (!v.is_active || !v.is_visible || v.availability === 'hidden' || !v.is_sellable) {
        warnings.push({ variationId, code: 'OUT_OF_STOCK', message: `${v.variation_name ?? name ?? 'This item'} is unavailable.` });
        continue;
      }
      if (closed) { warnings.push({ variationId, code: 'PREORDER_CLOSED', message: `${name} is no longer accepting pre-orders.` }); continue; }
      const available = preorder || v.stock === null || v.stock === undefined ? requested : Math.min(requested, Math.max(0, Number(v.stock)));
      if (available < requested) {
        warnings.push({ variationId, code: available ? 'QTY_REDUCED' : 'OUT_OF_STOCK', message: available ? `Only ${available} of ${name} can be added.` : `${name} is sold out.` });
      }
      if (!available) continue;
      if (v.max_per_customer && available > v.max_per_customer) {
        warnings.push({ variationId, code: 'LIMIT_EXCEEDED', message: `${name} is limited to ${v.max_per_customer} per customer.` });
        continue;
      }
      const unit = Number(v.price_cents);
      lines.push({ variationId, itemId: v.square_item_id, name, imageUrl: v.image_url ?? null, unitPriceCents: unit, quantity: available, isPreorder: preorder, lineCents: unit * available });
    }
    const subtotalCents = lines.reduce((t, l) => t + l.lineCents, 0);
    const shippingCents = input.shippingMethod === 'express'
      ? Number(settings.shipping_express_cents)
      : subtotalCents >= Number(settings.free_shipping_threshold_cents) ? 0 : Number(settings.shipping_standard_cents);
    const taxCents = Math.round((subtotalCents + shippingCents) * Number(tax?.rate ?? 0));
    return { lines, subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents, currency: 'CAD', warnings };
  }
}
