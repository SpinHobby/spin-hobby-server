import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import type { StorefrontProductRow } from '../../database/rows.js';

/** Orders that count as bought: paid, not cancelled or refunded. */
const BOUGHT = `o.paid_at is not null and o.status in ('paid', 'preorder_reserved', 'fulfilled', 'shipped')`;
/** What a shopper can still buy (not sold out, not a closed pre-order). */
const BUYABLE = `p.status in ('in', 'low', 'pre') and p.price_cents > 0`;
/** Add-ons are small extras: at most this much each. */
export const ADD_ON_MAX_CENTS = 3000;

/**
 * Suggestions from the shop's own orders, no tracking of anyone: "Frequently bought together" (items that were in the same paid
 * orders as this one) and add-ons for a cart (cheap items bought with what's in it, else the shop's best-selling cheap items).
 */
@Injectable()
export class RecommendationsService {
  constructor(private readonly db: Db) {}

  /** Up to `limit` items bought in the same orders as `itemId`, most often first; empty until two orders share items. */
  async boughtTogether(itemId: string, limit = 3) {
    return this.db.many<StorefrontProductRow>(
      `with mine as (
         select distinct i.order_id from public.order_items i join public.orders o on o.id = i.order_id
          where i.square_item_id = $1 and ${BOUGHT}
       ), together as (
         select i.square_item_id as id, count(distinct i.order_id)::int as orders
           from public.order_items i join mine using (order_id)
          where i.square_item_id <> $1
          group by i.square_item_id
       )
       select p.* from together t join public.storefront_products p on p.id = t.id
        where ${BUYABLE}
        order by t.orders desc, p.rank nulls last, p.id
        limit $2`,
      [itemId, limit],
    );
  }

  /** Up to `limit` cheap items for a cart of `itemIds`: bought with them first, then the best sellers, never what's in the cart. */
  async addOns(itemIds: string[], limit = 3) {
    return this.db.many<StorefrontProductRow>(
      `with cart_orders as (
         select distinct i.order_id from public.order_items i join public.orders o on o.id = i.order_id
          where i.square_item_id = any($1::text[]) and ${BOUGHT}
       ), together as (
         select i.square_item_id as id, count(distinct i.order_id)::int as orders
           from public.order_items i join cart_orders using (order_id)
          group by i.square_item_id
       )
       select p.* from public.storefront_products p left join together t on t.id = p.id
        where ${BUYABLE} and p.price_cents > 0 and p.price_cents <= $2 and not (p.id = any($1::text[]))
        order by coalesce(t.orders, 0) desc, p.rank nulls last, p.created_at desc, p.id
        limit $3`,
      [itemIds, ADD_ON_MAX_CENTS, limit],
    );
  }
}
