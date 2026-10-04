import { Body, Controller, Get, HttpCode, Logger, Param, Post, Query } from '@nestjs/common';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AdminLog } from './admin-log.service.js';
import { AppError, notFound } from '../../common/errors.js';
import {
  jsonBody,
  optionalString,
  positiveInteger,
  stringValue,
} from '../../common/validation/rules.js';
import { Db, type Row } from '../../database/db.service.js';
import { EmailService } from '../../integrations/email/email.service.js';
import { PayPalClient } from '../../integrations/paypal/paypal.client.js';
import { SquareClient } from '../../integrations/square/square.client.js';

const ORDER_STATUSES = [
  'pending',
  'paid',
  'preorder_reserved',
  'fulfilled',
  'shipped',
  'cancelled',
  'refunded',
];
const ORDER_WITH_ITEMS = `select o.*, coalesce((select json_agg(i order by i.id) from public.order_items i where i.order_id = o.id), '[]') as order_items`;
const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] ?? c,
  );

export function packingSlipHtml(order: Row) {
  const s = (order.shipping_address ?? {}) as Row;
  const items = (order.order_items ?? [])
    .map((i: Row) => `<tr><td>${escape(i.name)}</td><td>${i.quantity}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slip #${order.id}</title><style>body{font:14px system-ui;margin:32px;color:#171a2b}h1{margin:0 0 24px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style></head><body><h1>Spin Hobby · Packing slip #${order.id}</h1><p><strong>Ship to</strong><br>${escape(s.firstName ?? s.name?.first)} ${escape(s.lastName ?? s.name?.last)}<br>${escape(s.address1 ?? s.address?.primary)}<br>${escape(s.address2 ?? s.address?.secondary)}<br>${escape(s.city)}, ${escape(s.province)} ${escape(s.postalCode)}</p><table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>${items}</tbody></table></body></html>`;
}

@Controller('admin/orders')
@Access('staff')
export class AdminOrdersController {
  private readonly logger = new Logger(AdminOrdersController.name);
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
    private readonly email: EmailService,
    private readonly paypal: PayPalClient,
    private readonly square: SquareClient,
  ) {}

  @Get()
  async list(@Query('status') status?: string, @Query('limit') limitParam?: string) {
    const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 100);
    const filtered = status && status !== 'all';
    if (filtered && !ORDER_STATUSES.includes(status)) throw new AppError('Invalid order status.');
    const [items, count] = await Promise.all([
      this.db.many(
        `${ORDER_WITH_ITEMS} from public.orders o ${filtered ? 'where o.status = $1::public.order_status' : ''} order by o.created_at desc limit ${limit}`,
        filtered ? [status] : [],
      ),
      this.db.one<{ total: number }>(
        `select count(*)::int as total from public.orders ${filtered ? 'where status = $1::public.order_status' : ''}`,
        filtered ? [status] : [],
      ),
    ]);
    return { success: true, items, total: count?.total ?? 0 };
  }

  private async load(id: string) {
    const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
    const order = await this.db.one(
      `${ORDER_WITH_ITEMS}, coalesce((select json_agg(e order by e.created_at) from public.order_events e where e.order_id = o.id), '[]') as order_events
         from public.orders o where o.id = $1`,
      [orderId],
    );
    if (!order) throw notFound('Order');
    return order;
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return { success: true, order: await this.load(id) };
  }

  @Get(':id/packing-slip')
  async packingSlip(@Param('id') id: string) {
    return { success: true, html: packingSlipHtml(await this.load(id)) };
  }

  @Post(':id/ship')
  @HttpCode(200)
  async ship(@CurrentUser() admin: AppUser, @Param('id') id: string, @Body() body: unknown) {
    const payload = jsonBody(body);
    const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
    const trackingNumber = stringValue(payload.trackingNumber, 'trackingNumber', 200);
    const carrier = optionalString(payload.carrier, 100);
    const order = await this.db.transaction(async (tx) => {
      const current = await this.db.one<Row>(
        'select id, status, billing_email from public.orders where id = $1 for update',
        [orderId],
        tx,
      );
      if (!current || !['paid', 'fulfilled'].includes(current.status))
        throw new AppError('Only paid orders can be shipped.');
      await this.db.exec(
        "update public.orders set status = 'shipped', tracking_number = $2, carrier = $3, shipped_at = now() where id = $1",
        [orderId, trackingNumber, carrier],
        tx,
      );
      await this.db.exec(
        "insert into public.order_events (order_id, actor_id, event_type, data) values ($1, $2, 'shipped', $3)",
        [orderId, admin.id, JSON.stringify({ tracking_number: trackingNumber, carrier })],
        tx,
      );
      await this.log.write(
        admin.id,
        'order.shipped',
        String(orderId),
        { trackingNumber, carrier },
        tx,
      );
      return current;
    });
    // Customer notification is best-effort: the shipment is already recorded.
    let customerEmailed = false;
    if (this.email.configured) {
      customerEmailed = await this.email
        .send(
          order.billing_email,
          `Your Spin Hobby order #${orderId} has shipped`,
          this.email.shippedHtml(orderId, carrier, trackingNumber),
        )
        .catch((e) => {
          this.logger.warn(`Shipping email for #${orderId} failed: ${e}`);
          return false;
        });
    }
    return { success: true, customerEmailed };
  }

  @Post(':id/refund')
  @HttpCode(200)
  @Access('owner')
  async refund(@CurrentUser() admin: AppUser, @Param('id') id: string, @Body() body: unknown) {
    const payload = jsonBody(body ?? {});
    const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
    const order = await this.db.one<Row>('select * from public.orders where id = $1', [orderId]);
    if (
      !order?.provider_payment_id ||
      !['paid', 'preorder_reserved', 'shipped', 'fulfilled'].includes(order.status)
    )
      throw new AppError('This order cannot be refunded.');
    const total = Number(order.total_cents);
    const amountCents =
      payload.amountCents === undefined
        ? total
        : positiveInteger(payload.amountCents, 'amountCents', total);
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
        [orderId, admin.id, JSON.stringify({ amount_cents: amountCents })],
        tx,
      );
      await this.log.write(admin.id, 'order.refunded', String(orderId), { amountCents }, tx);
    });
    return { success: true, status };
  }
}
