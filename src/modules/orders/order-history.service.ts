import { Injectable } from '@nestjs/common';
import { notFound } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { AppUser } from '../auth/auth.service.js';
import { EVENTS_AS_JSON, ITEMS_AS_JSON } from './order-sql.js';

/** Looking up orders as the customer who placed them (or as staff). */
@Injectable()
export class OrderHistoryService {
  constructor(private readonly db: Db) {}

  /** All of a customer's orders, newest first. */
  list(userId: string) {
    return this.db.many('select * from public.orders where user_id = $1 order by created_at desc', [
      userId,
    ]);
  }

  /** Guest lookup from the confirmation email: needs both the payment id and the billing email. */
  async lookupAsGuest(paymentId: string, email: string) {
    const order = await this.db.one(
      `select o.*, ${ITEMS_AS_JSON}
         from public.orders o where o.provider_payment_id = $1 and o.billing_email = $2`,
      [paymentId, email],
    );
    if (!order) throw notFound('Order');
    return order;
  }

  /** One order with its items and history. Customers only see their own; staff and owners see any. */
  async findFor(user: AppUser, orderId: number) {
    const order = await this.db.one(
      `select o.*, ${ITEMS_AS_JSON}, ${EVENTS_AS_JSON}
         from public.orders o
        where o.id = $1 and ($2::boolean or o.user_id = $3)`,
      [orderId, user.role !== 'customer', user.id],
    );
    if (!order) throw notFound('Order');
    return order;
  }
}
