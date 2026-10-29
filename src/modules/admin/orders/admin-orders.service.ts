import { Injectable, Logger } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { positiveInteger } from '../../../common/validation/rules.js';
import { Db } from '../../../database/db.service.js';
import type { OrderRow, OrderWithDetails, OrderWithItems } from '../../../database/rows.js';
import { EmailService } from '../../../integrations/email/email.service.js';
import { PayPalClient } from '../../../integrations/paypal/paypal.client.js';
import { SquareHttpClient } from '../../../integrations/square/square-http.client.js';
import { EVENTS_AS_JSON, ITEMS_AS_JSON } from '../../orders/order-history.service.js';
import { AdminLog } from '../admin-log.service.js';
import type { RefundOrderDto, ShipOrderDto } from './dto/orders.dto.js';
import { packingSlipHtml } from './packing-slip.js';

const ORDER_STATUSES = [
  'pending',
  'paid',
  'preorder_reserved',
  'fulfilled',
  'shipped',
  'cancelled',
  'refunded',
];
/** Statuses an order has been paid in, so it can still be refunded. */
const REFUNDABLE = ['paid', 'preorder_reserved', 'shipped', 'fulfilled'];

/** Looking at, shipping and refunding customers' orders. */
@Injectable()
export class AdminOrdersService {
  private readonly logger = new Logger(AdminOrdersService.name);

  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
    private readonly email: EmailService,
    private readonly paypal: PayPalClient,
    private readonly square: SquareHttpClient,
  ) {}

  /** Newest first, with their items; optionally only one status. */
  async list(status?: string, limitParam?: string) {
    const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 100);
    const filtered = Boolean(status && status !== 'all');
    if (filtered && !ORDER_STATUSES.includes(status!)) throw new AppError('Invalid order status.');
    const params = filtered ? [status] : [];
    const [items, count] = await Promise.all([
      this.db.many<OrderWithItems>(
        `select o.*, ${ITEMS_AS_JSON} from public.orders o ${filtered ? 'where o.status = $1::public.order_status' : ''} order by o.created_at desc limit ${limit}`,
        params,
      ),
      this.db.one<{ total: number }>(
        `select count(*)::int as total from public.orders ${filtered ? 'where status = $1::public.order_status' : ''}`,
        params,
      ),
    ]);
    return { items, total: count?.total ?? 0 };
  }

  /** One order with its items and full history. */
  async detail(orderId: number) {
    const order = await this.db.one<OrderWithDetails>(
      `select o.*, ${ITEMS_AS_JSON}, ${EVENTS_AS_JSON} from public.orders o where o.id = $1`,
      [orderId],
    );
    if (!order) throw notFound('Order');
    return order;
  }

  async packingSlip(orderId: number) {
    return packingSlipHtml(await this.detail(orderId));
  }

  /**
   * Marks a paid order shipped and records the tracking number. Emailing the customer is best-effort: the
   * shipment is already recorded, so a mail problem never fails the request. Returns whether the email went out.
   */
  async ship(adminId: string, orderId: number, dto: ShipOrderDto) {
    const order = await this.db.transaction(async (tx) => {
      const current = await this.db.one<Pick<OrderRow, 'id' | 'status' | 'billing_email'>>(
        'select id, status, billing_email from public.orders where id = $1 for update',
        [orderId],
        tx,
      );
      if (!current || !['paid', 'fulfilled'].includes(current.status))
        throw new AppError('Only paid orders can be shipped.');
      await this.db.exec(
        "update public.orders set status = 'shipped', tracking_number = $2, carrier = $3, shipped_at = now() where id = $1",
        [orderId, dto.trackingNumber, dto.carrier],
        tx,
      );
      await this.db.exec(
        "insert into public.order_events (order_id, actor_id, event_type, data) values ($1, $2, 'shipped', $3)",
        [
          orderId,
          adminId,
          JSON.stringify({ tracking_number: dto.trackingNumber, carrier: dto.carrier }),
        ],
        tx,
      );
      await this.log.write(
        adminId,
        'order.shipped',
        String(orderId),
        { trackingNumber: dto.trackingNumber, carrier: dto.carrier },
        tx,
      );
      return current;
    });
    if (!this.email.configured) return false;
    return this.email
      .send(
        order.billing_email,
        `Your Spin Hobby order #${orderId} has shipped`,
        this.email.shippedHtml(orderId, dto.carrier, dto.trackingNumber),
      )
      .catch((e) => {
        this.logger.warn(`Shipping email for #${orderId} failed: ${e}`);
        return false;
      });
  }

  /**
   * Refunds the whole order or part of it through the provider that took the payment, then emails the customer. Returns the new
   * status and whether the email went out (a failed email never undoes the refund).
   */
  async refund(adminId: string, orderId: number, dto: RefundOrderDto) {
    const order = await this.db.one<OrderRow>('select * from public.orders where id = $1', [
      orderId,
    ]);
    if (!order?.provider_payment_id || !REFUNDABLE.includes(order.status))
      throw new AppError('This order cannot be refunded.');
    const total = Number(order.total_cents);
    const amountCents =
      dto.amountCents === undefined
        ? total
        : positiveInteger(dto.amountCents, 'amountCents', total);
    if (order.provider === 'paypal') {
      await this.paypal.refund(order.provider_payment_id, order.id, amountCents);
    } else {
      const key = `spin-hobby-refund-${order.id}-${amountCents}`;
      await this.square.request(
        '/v2/refunds',
        {
          idempotency_key: key,
          payment_id: order.provider_payment_id,
          amount_money: { amount: amountCents, currency: 'CAD' },
        },
        key,
      );
    }
    const status = amountCents === total ? 'refunded' : order.status;
    await this.db.transaction(async (tx) => {
      await this.db.exec(
        'update public.orders set status = $2 where id = $1',
        [orderId, status],
        tx,
      );
      await this.db.exec(
        "insert into public.order_events (order_id, actor_id, event_type, data) values ($1, $2, 'refunded', $3)",
        [orderId, adminId, JSON.stringify({ amount_cents: amountCents })],
        tx,
      );
      await this.log.write(adminId, 'order.refunded', String(orderId), { amountCents }, tx);
    });
    const customerEmailed =
      !!order.billing_email && this.email.configured
        ? await this.email
            .send(
              order.billing_email,
              amountCents === total
                ? `Your Spin Hobby order #${orderId} has been refunded`
                : `A refund on your Spin Hobby order #${orderId}`,
              this.email.refundedHtml(orderId, amountCents, amountCents === total),
            )
            .catch((e) => {
              this.logger.warn(`Refund email for #${orderId} failed: ${e}`);
              return false;
            })
        : false;
    return { status, customerEmailed };
  }
}
