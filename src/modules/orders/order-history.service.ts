import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { AppUser } from '../auth/auth.service.js';
import type { OrderRow, OrderWithDetails } from '../../database/rows.js';

/** Looking up orders as the customer who placed them (or as staff). */

/**
 * SQL fragments that attach an order's line items and history as JSON arrays. Both expect the orders
 * table to be aliased `o`. Used here and by the admin orders screen (AdminOrdersService imports them).
 */
export const ITEMS_AS_JSON = `coalesce((select json_agg(i order by i.id) from public.order_items i where i.order_id = o.id), '[]') as order_items`;
export const EVENTS_AS_JSON = `coalesce((select json_agg(e order by e.created_at) from public.order_events e where e.order_id = o.id), '[]') as order_events`;

@Injectable()
export class OrderHistoryService {
  constructor(private readonly db: Db) {}

  /** All of a customer's orders, newest first. */
  list(userId: string) {
    return this.db.many<OrderRow>(
      'select * from public.orders where user_id = $1 order by created_at desc',
      [userId],
    );
  }

  /**
   * Guest lookup: the order number and the email it was placed with (any capitals). Unpaid checkouts don't count. Returns only
   * what the customer needs to follow the order (no payment ids, no street address), and the same answer for a wrong number
   * as for a wrong email, so it says nothing about orders that aren't theirs.
   */
  async lookupAsGuest(orderId: number, email: string) {
    const order = await this.db.one<OrderWithDetails>(
      `select o.*, ${ITEMS_AS_JSON}, ${EVENTS_AS_JSON}
         from public.orders o
        where o.id = $1 and lower(o.billing_email) = $2 and o.status <> 'pending'`,
      [orderId, email.toLowerCase()],
    );
    if (!order) throw new AppError("We couldn't find an order with that number and email.", 404);
    const ship = order.shipping_address ?? {};
    const refunded = order.order_events
      .filter((e) => e.event_type === 'refunded')
      .reduce(
        (sum, e) => sum + Number((e.data as { amount_cents?: number } | null)?.amount_cents ?? 0),
        0,
      );
    return {
      id: order.id,
      status: order.status,
      createdAt: order.created_at,
      shippingMethod: order.shipping_method,
      subtotalCents: Number(order.subtotal_cents),
      shippingCents: Number(order.shipping_cents),
      taxCents: Number(order.tax_cents),
      totalCents: Number(order.total_cents),
      refundedCents: refunded,
      carrier: order.carrier,
      trackingNumber: order.tracking_number,
      shippedAt: order.shipped_at,
      shipTo: {
        city: ship.city ?? null,
        province: ship.province ?? null,
        country: ship.country ?? null,
      },
      items: order.order_items.map((i) => ({
        name: i.name,
        imageUrl: i.image_url,
        quantity: Number(i.quantity),
        unitPriceCents: Number(i.unit_price_cents),
        isPreorder: i.is_preorder,
      })),
      events: order.order_events
        .filter((e) => ['created', 'paid', 'shipped', 'refunded'].includes(e.event_type))
        .map((e) => ({ type: e.event_type, at: e.created_at })),
    };
  }

  /** One order with its items and history. Customers only see their own; staff and owners see any. */
  async findFor(user: AppUser, orderId: number) {
    const order = await this.db.one<OrderWithDetails>(
      `select o.*, ${ITEMS_AS_JSON}, ${EVENTS_AS_JSON}
         from public.orders o
        where o.id = $1 and ($2::boolean or o.user_id = $3)`,
      [orderId, user.role !== 'customer', user.id],
    );
    if (!order) throw notFound('Order');
    return order;
  }
}
