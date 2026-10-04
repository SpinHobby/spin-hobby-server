import { Injectable } from '@nestjs/common';
import type { AppUser } from '../auth/auth.service.js';
import type { QuoteInput } from '../orders/quote.service.js';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';
import { Db, type Row } from '../../database/db.service.js';
import { OrdersService, type OrderDetails } from '../orders/orders.service.js';
import { PayPalClient } from '../../integrations/paypal/paypal.client.js';
import { isManualId } from '../catalog/manual-id.js';
import { SquareClient } from '../../integrations/square/square.client.js';

export interface PaymentStarted {
  orderId: number;
  provider: 'paypal' | 'square';
  paypalOrderId?: string;
  amountCents?: number;
  currency?: 'CAD';
  idempotencyKey?: string;
}
export interface PaymentResult {
  orderId: number;
  status: string;
}

const alreadyPaid = (order: Row) => order.status === 'paid' || order.status === 'preorder_reserved';

/** Talks to PayPal and Square on behalf of an order; OrdersService records what happened. */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: Db,
    private readonly orders: OrdersService,
    private readonly paypal: PayPalClient,
    private readonly square: SquareClient,
  ) {}

  /** Creates the order (holding its stock) and prepares it for the store's active provider. */
  async start(
    input: QuoteInput,
    details: OrderDetails,
    user: AppUser | null,
  ): Promise<PaymentStarted> {
    const created = await this.orders.createFromQuote(input, details, user);
    if ('changed' in created) {
      throw new AppError(
        'Your cart changed. Review the updated quote before checking out.',
        409,
        'CART_CHANGED',
        { quote: created.changed },
      );
    }
    const { order, quote } = created;
    if (order.provider === 'paypal') {
      try {
        const paypalOrderId = await this.paypal.createOrder(order.id, quote.totalCents);
        await this.db.exec('update public.orders set provider_metadata = $2 where id = $1', [
          order.id,
          JSON.stringify({ paypal_order_id: paypalOrderId }),
        ]);
        return { orderId: order.id, provider: 'paypal', paypalOrderId };
      } catch (error) {
        await this.db.exec("update public.orders set status = 'cancelled' where id = $1", [
          order.id,
        ]);
        throw error;
      }
    }
    return {
      orderId: order.id,
      provider: 'square',
      amountCents: quote.totalCents,
      currency: 'CAD',
      idempotencyKey: `spin-hobby-${order.id}`,
    };
  }

  async capturePayPal(paypalOrderId: string): Promise<PaymentResult> {
    const order = await this.db.one<Row>(
      "select * from public.orders where provider = 'paypal' and provider_metadata ->> 'paypal_order_id' = $1",
      [paypalOrderId],
    );
    if (!order) throw new AppError('Checkout order not found.', 404);
    if (alreadyPaid(order)) return { orderId: order.id, status: order.status };
    await this.orders.assertCapturable(order);

    const result = await this.paypal.capture(paypalOrderId, order.id);
    if (result.status !== 'COMPLETED')
      throw new AppError('PayPal did not complete this payment.', 402);
    const captureId = result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new AppError('PayPal did not return a payment ID.', 502);
    const { status } = await this.orders.markPaid(
      order.id,
      captureId,
      result.links?.find((l: Row) => l.rel === 'self')?.href ?? null,
      { paypal_order_id: paypalOrderId, capture_id: captureId },
    );
    return { orderId: order.id, status };
  }

  async captureSquare(
    orderId: number,
    billingEmail: string,
    sourceId: string,
    verificationToken?: string,
  ): Promise<PaymentResult> {
    const locationId = env('SQUARE_LOCATION_ID');
    if (!locationId) throw new AppError('Square Payments is not configured.', 503);

    const order = await this.db.one<Row>(
      "select * from public.orders where id = $1 and provider = 'square' and billing_email = $2",
      [orderId, billingEmail],
    );
    if (!order) throw new AppError('Checkout order not found.', 404);
    if (alreadyPaid(order)) return { orderId: order.id, status: order.status };
    await this.orders.assertCapturable(order);

    const squareOrderId =
      order.square_order_id ?? (await this.createSquareOrder(order, locationId));
    const payment = await this.square.request(
      '/v2/payments',
      {
        source_id: sourceId,
        idempotency_key: `spin-hobby-payment-${order.id}`,
        amount_money: { amount: order.total_cents, currency: 'CAD' },
        order_id: squareOrderId,
        location_id: locationId,
        buyer_email_address: order.billing_email,
        ...(verificationToken ? { verification_token: verificationToken } : {}),
      },
      `spin-hobby-payment-${order.id}`,
    );
    if (payment.payment?.status !== 'COMPLETED')
      throw new AppError('Square did not complete this payment.', 402);
    const { status } = await this.orders.markPaid(
      order.id,
      payment.payment.id,
      payment.payment.receipt_url ?? null,
      { square_order_id: squareOrderId, payment_id: payment.payment.id },
    );
    return { orderId: order.id, status };
  }

  /** Mirrors our order into Square (so it shows in their dashboard and decrements their stock) and remembers its id. */
  private async createSquareOrder(order: Row, locationId: string): Promise<string> {
    const lines = await this.db.many(
      'select * from public.order_items where order_id = $1 order by id',
      [order.id],
    );
    const created = await this.square.request(
      '/v2/orders',
      {
        order: {
          location_id: locationId,
          reference_id: `spin-hobby-${order.id}`,
          line_items: lines.map((l) => ({
            ...(isManualId(l.square_item_id) ? {} : { catalog_object_id: l.square_variation_id }),
            name: l.name,
            quantity: String(l.quantity),
            base_price_money: { amount: l.unit_price_cents, currency: 'CAD' },
          })),
          service_charges: [
            ...(order.shipping_cents
              ? [
                  {
                    name: 'Shipping',
                    amount_money: { amount: order.shipping_cents, currency: 'CAD' },
                  },
                ]
              : []),
            ...(order.tax_cents
              ? [{ name: 'Sales tax', amount_money: { amount: order.tax_cents, currency: 'CAD' } }]
              : []),
          ],
        },
        idempotency_key: `spin-hobby-order-${order.id}`,
      },
      `spin-hobby-order-${order.id}`,
    );
    const squareOrderId = created.order?.id as string | undefined;
    if (!squareOrderId) throw new AppError('Square did not return an order ID.', 502);
    await this.db.exec('update public.orders set square_order_id = $2 where id = $1', [
      order.id,
      squareOrderId,
    ]);
    return squareOrderId;
  }
}
