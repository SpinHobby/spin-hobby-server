import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AppUser } from '../auth/auth.service.js';
import { QuoteService, type Quote, type QuoteInput } from './quote.service.js';
import { AppError, errorText } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { InventorySnapshotRow, OrderItemRow, OrderRow } from '../../database/rows.js';
import { EmailService } from '../../integrations/email/email.service.js';
import { StoreService } from '../store/store.service.js';
import { orderExpiryIntervalMinutes, orderHoldMinutes } from '../../config/orders.config.js';

export interface OrderDetails {
  email: string;
  billing: unknown;
  shipping: unknown;
}
export type CreatedOrder =
  | { changed: Quote }
  | { order: { id: number; total_cents: number; provider: 'paypal' | 'square' }; quote: Quote };

const EXPIRED_MESSAGE = 'This checkout expired. Please check out again.';

/**
 * Order lifecycle: creating a checkout (which holds its stock), recording payment, and letting
 * abandoned checkouts go. Stock is held by pending orders for ORDER_HOLD_MINUTES (see QuoteService.held),
 * so correctness never depends on the cleanup job; the job only tidies statuses.
 */
@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly quotes: QuoteService,
    private readonly store: StoreService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    const minutes = orderExpiryIntervalMinutes();
    if (!(minutes > 0)) return;
    this.timer = setInterval(() => {
      this.expireStale()
        .then((n) => {
          if (n) this.logger.log(`Cancelled ${n} abandoned checkout(s).`);
        })
        .catch((e) => this.logger.error(`Expiring abandoned checkouts failed: ${e.message}`));
    }, minutes * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Quote, order, items and the audit event commit together or not at all; the order then holds its stock. */
  async createFromQuote(
    input: QuoteInput,
    details: OrderDetails,
    user: AppUser | null,
  ): Promise<CreatedOrder> {
    return this.db.transaction(async (tx) => {
      // Shoppers competing for the same variations queue up here. Locks are taken in sorted order so two
      // carts can never deadlock, and are released when this transaction commits.
      for (const id of input.items.map((i) => i.variationId).sort()) {
        await this.db.exec('select pg_advisory_xact_lock(hashtext($1))', [`stock:${id}`], tx);
      }
      const quote = await this.quotes.quote(input, tx);
      if (!quote.lines.length || quote.warnings.length) return { changed: quote };
      const settings = await this.store.settings(tx);
      const order = await this.db.one<Pick<OrderRow, 'id' | 'total_cents' | 'provider'>>(
        `insert into public.orders (user_id, provider, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_method, billing_email, billing_address, shipping_address)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, total_cents, provider`,
        [
          user?.id ?? null,
          settings.payment_provider,
          quote.subtotalCents,
          quote.shippingCents,
          quote.taxCents,
          quote.totalCents,
          input.shippingMethod,
          details.email,
          JSON.stringify(details.billing),
          JSON.stringify(details.shipping),
        ],
        tx,
      );
      for (const line of quote.lines) {
        await this.db.exec(
          `insert into public.order_items (order_id, square_item_id, square_variation_id, name, image_url, unit_price_cents, quantity, is_preorder)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            order!.id,
            line.itemId,
            line.variationId,
            line.name,
            line.imageUrl,
            line.unitPriceCents,
            line.quantity,
            line.isPreorder,
          ],
          tx,
        );
      }
      await this.db.exec(
        "insert into public.order_events (order_id, actor_id, event_type, data) values ($1, $2, 'created', $3)",
        [order!.id, user?.id ?? null, JSON.stringify({ quote })],
        tx,
      );
      return {
        order: order!,
        quote,
      };
    });
  }

  /** Throws before any money moves when an order can't (or shouldn't) be charged any more. */
  async assertCapturable(order: Pick<OrderRow, 'id' | 'status' | 'created_at'>): Promise<void> {
    if (order.status === 'cancelled') throw new AppError(EXPIRED_MESSAGE, 409, 'ORDER_EXPIRED');
    if (order.status !== 'pending')
      throw new AppError('This order can no longer be captured.', 409);
    const ageMs = Date.now() - new Date(order.created_at).getTime();
    if (ageMs <= orderHoldMinutes() * 60_000) return;

    // The hold lapsed, so the stock may have gone to someone else: re-check against everyone else's holds.
    const items = await this.db.many<Pick<OrderItemRow, 'square_variation_id'> & { qty: number }>(
      'select square_variation_id, sum(quantity)::int as qty from public.order_items where order_id = $1 and not is_preorder group by 1',
      [order.id],
    );
    if (!items.length) return;
    const ids = items.map((i) => i.square_variation_id);
    const [held, stock] = await Promise.all([
      this.quotes.held(ids, undefined, order.id),
      this.db.many<Pick<InventorySnapshotRow, 'square_variation_id' | 'quantity'>>(
        'select square_variation_id, quantity from public.inventory_snapshots where square_variation_id = any($1::text[])',
        [ids],
      ),
    ]);
    const quantity = new Map(stock.map((s) => [s.square_variation_id, s.quantity]));
    for (const item of items) {
      const left = quantity.get(item.square_variation_id);
      if (left === null || left === undefined) continue; // not stock-tracked
      if (Number(left) - (held.get(item.square_variation_id) ?? 0) < Number(item.qty)) {
        throw new AppError(
          'Some items sold out while you were checking out. Please check out again.',
          409,
          'ORDER_EXPIRED',
        );
      }
    }
  }

  /**
   * Records a payment the provider has confirmed. Idempotent: only a pending (or just-expired, since the
   * money really moved) order changes, so a retry or a second capture does nothing the second time.
   */
  async markPaid(
    orderId: number,
    paymentId: string,
    receiptUrl: string | null,
    data: Record<string, unknown>,
  ): Promise<{ status: string; first: boolean }> {
    const result = await this.recordPayment(orderId, paymentId, receiptUrl, data);
    if (result.first) await this.sendConfirmation(orderId);
    return result;
  }

  private async recordPayment(
    orderId: number,
    paymentId: string,
    receiptUrl: string | null,
    data: Record<string, unknown>,
  ): Promise<{ status: string; first: boolean }> {
    return this.db.transaction(async (tx) => {
      const current = await this.db.one<Pick<OrderRow, 'status'>>(
        'select status from public.orders where id = $1 for update',
        [orderId],
        tx,
      );
      if (!current) throw new AppError('Checkout order not found.', 404);
      if (current.status !== 'pending' && current.status !== 'cancelled')
        return { status: current.status, first: false };

      const preorder = await this.db.one(
        'select 1 from public.order_items where order_id = $1 and is_preorder limit 1',
        [orderId],
        tx,
      );
      const status = preorder ? 'preorder_reserved' : 'paid';
      await this.db.exec(
        'update public.orders set status = $2::public.order_status, provider_payment_id = $3, receipt_url = $4, paid_at = now() where id = $1',
        [orderId, status, paymentId, receiptUrl],
        tx,
      );
      // Hand-entered products have no other source of truth for stock, so take the sale off now.
      // (Square-sourced stock comes back from Square; QuoteService.held bridges the gap until it does.)
      await this.db.exec(
        `update public.inventory_snapshots s
            set quantity = greatest(s.quantity - sold.qty, 0)
           from (
             select it.square_variation_id, sum(it.quantity)::int as qty
               from public.order_items it
               join public.catalog_products p on p.square_item_id = it.square_item_id and p.source = 'manual'
              where it.order_id = $1 and not it.is_preorder
              group by 1
           ) sold
          where s.square_variation_id = sold.square_variation_id and s.quantity is not null`,
        [orderId],
        tx,
      );
      const event = current.status === 'cancelled' ? { ...data, late: true } : data;
      await this.db.exec(
        "insert into public.order_events (order_id, event_type, data) values ($1, 'paid', $2)",
        [orderId, JSON.stringify(event)],
        tx,
      );
      return { status, first: true };
    });
  }

  /** Best-effort receipt, sent after the payment is safely recorded; a mail problem must never fail a paid checkout. */
  private async sendConfirmation(orderId: number): Promise<void> {
    if (!this.email.configured) return;
    try {
      const order = await this.db.one<OrderRow>('select * from public.orders where id = $1', [
        orderId,
      ]);
      if (!order?.billing_email) return;
      const [items, settings] = await Promise.all([
        this.db.many<Pick<OrderItemRow, 'name' | 'quantity' | 'unit_price_cents' | 'is_preorder'>>(
          'select name, quantity, unit_price_cents, is_preorder from public.order_items where order_id = $1 order by id',
          [orderId],
        ),
        this.store.settings(),
      ]);
      const sent = await this.email.send(
        order.billing_email,
        `Your Spin Hobby order #${orderId} is confirmed`,
        this.email.confirmationHtml(order, items, {
          days_min: Number(settings.handling_days_min),
          days_max: Number(settings.handling_days_max),
        }),
      );
      if (sent)
        await this.db.exec(
          "insert into public.order_events (order_id, event_type) values ($1, 'confirmation_emailed')",
          [orderId],
        );
    } catch (e) {
      this.logger.warn(`Confirmation email for order #${orderId} failed: ${errorText(e)}`);
    }
  }

  /** Cancels checkouts nobody finished within the hold window and frees their stock. */
  async expireStale(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await this.db.many<Pick<OrderRow, 'id'>>(
        `update public.orders set status = 'cancelled'
          where status = 'pending' and created_at < now() - make_interval(mins => $1::int) returning id`,
        [orderHoldMinutes()],
        tx,
      );
      if (rows.length) {
        await this.db.exec(
          "insert into public.order_events (order_id, event_type, data) select unnest($1::bigint[]), 'expired', '{}'::jsonb",
          [rows.map((r) => r.id)],
          tx,
        );
      }
      return rows.length;
    });
  }
}
