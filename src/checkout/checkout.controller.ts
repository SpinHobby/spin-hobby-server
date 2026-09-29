import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors.js';
import { email as validEmail, jsonBody, positiveInteger, stringValue, type Json } from '../common/validation.js';
import { env, paypalIsLive, squareEnvIsProduction } from '../config/env.js';
import { Db, type Row } from '../db/db.service.js';
import { PayPalClient } from '../payments/paypal.client.js';
import { SquareClient } from '../payments/square.client.js';
import { StoreService } from '../store/store.service.js';
import { parseQuoteInput, QuoteService } from './quote.service.js';

@Controller()
export class CheckoutController {
  constructor(
    private readonly db: Db,
    private readonly quotes: QuoteService,
    private readonly store: StoreService,
    private readonly paypal: PayPalClient,
    private readonly square: SquareClient,
  ) {}

  /** Public, non-secret values the checkout page needs to render the active payment method. */
  @Get('checkout/config')
  async config() {
    const s = await this.store.settings();
    return {
      success: true,
      provider: s.payment_provider,
      paypalClientId: env('PAYPAL_CLIENT_ID') ?? null,
      paypalEnv: paypalIsLive() ? 'live' : 'sandbox',
      squareApplicationId: env('SQUARE_APPLICATION_ID') ?? null,
      squareLocationId: env('SQUARE_LOCATION_ID') ?? null,
      squareEnv: squareEnvIsProduction() ? 'production' : 'sandbox',
      shippingStandardCents: s.shipping_standard_cents,
      shippingExpressCents: s.shipping_express_cents,
      freeShippingThresholdCents: s.free_shipping_threshold_cents,
      handlingDaysMin: s.handling_days_min,
      handlingDaysMax: s.handling_days_max,
      fxCadUsd: Number(s.fx_cad_usd),
    };
  }

  @Post('cart/quote')
  @HttpCode(200)
  async quote(@Body() body: unknown) {
    return { success: true, ...(await this.quotes.quote(parseQuoteInput(jsonBody(body)))) };
  }

  @Post('checkout/intent')
  @HttpCode(200)
  async intent(@CurrentUser() user: AppUser | null, @Body() body: unknown) {
    const payload = jsonBody(body);
    const rawQuote = (payload.quoteInput ?? payload.quote) as Json;
    if (!rawQuote || typeof rawQuote !== 'object' || Array.isArray(rawQuote)) throw new AppError('quoteInput is required.');
    const billingEmail = validEmail(payload.email);
    if (!payload.billing || typeof payload.billing !== 'object' || !payload.shipping || typeof payload.shipping !== 'object') {
      throw new AppError('Billing and shipping addresses are required.');
    }
    const input = parseQuoteInput(rawQuote);

    // Quote, order, items and the audit event commit together or not at all.
    const created = await this.db.transaction(async (tx) => {
      const quote = await this.quotes.quote(input, tx);
      if (!quote.lines.length || quote.warnings.length) return { changed: quote } as const;
      const settings = await this.store.settings(tx);
      const order = await this.db.one<Row>(
        `insert into public.orders (user_id, provider, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_method, billing_email, billing_address, shipping_address)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id, total_cents, provider`,
        [user?.id ?? null, settings.payment_provider, quote.subtotalCents, quote.shippingCents, quote.taxCents, quote.totalCents,
          input.shippingMethod, billingEmail, JSON.stringify(payload.billing), JSON.stringify(payload.shipping)],
        tx,
      );
      for (const line of quote.lines) {
        await this.db.exec(
          `insert into public.order_items (order_id, square_item_id, square_variation_id, name, image_url, unit_price_cents, quantity, is_preorder)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [order!.id, line.itemId, line.variationId, line.name, line.imageUrl, line.unitPriceCents, line.quantity, line.isPreorder],
          tx,
        );
      }
      await this.db.exec(
        "insert into public.order_events (order_id, actor_id, event_type, data) values ($1, $2, 'created', $3)",
        [order!.id, user?.id ?? null, JSON.stringify({ quote })],
        tx,
      );
      return { order: order!, quote } as const;
    });

    if ('changed' in created) {
      throw new AppError('Your cart changed. Review the updated quote before checking out.', 409, 'CART_CHANGED', { quote: created.changed });
    }
    const { order, quote } = created;
    if (order.provider === 'paypal') {
      try {
        const paypalOrderId = await this.paypal.createOrder(order.id, quote.totalCents);
        await this.db.exec('update public.orders set provider_metadata = $2 where id = $1', [order.id, JSON.stringify({ paypal_order_id: paypalOrderId })]);
        return { success: true, orderId: order.id, provider: 'paypal', paypalOrderId };
      } catch (error) {
        await this.db.exec("update public.orders set status = 'cancelled' where id = $1", [order.id]);
        throw error;
      }
    }
    return { success: true, orderId: order.id, provider: 'square', amountCents: quote.totalCents, currency: 'CAD', idempotencyKey: `spin-hobby-${order.id}` };
  }

  @Post('paypal/capture')
  @HttpCode(200)
  async capturePayPal(@Body() body: unknown) {
    const paypalOrderId = stringValue(jsonBody(body).paypalOrderId, 'paypalOrderId', 200);
    const order = await this.db.one<Row>(
      "select * from public.orders where provider = 'paypal' and provider_metadata ->> 'paypal_order_id' = $1",
      [paypalOrderId],
    );
    if (!order) throw new AppError('Checkout order not found.', 404);
    if (order.status === 'paid' || order.status === 'preorder_reserved') return { success: true, orderId: order.id, status: order.status };
    if (order.status !== 'pending') throw new AppError('This order can no longer be captured.', 409);

    const result = await this.paypal.capture(paypalOrderId, order.id);
    if (result.status !== 'COMPLETED') throw new AppError('PayPal did not complete this payment.', 402);
    const captureId = result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new AppError('PayPal did not return a payment ID.', 502);
    const status = await this.markPaid(order.id, captureId, result.links?.find((l: Row) => l.rel === 'self')?.href ?? null,
      { paypal_order_id: paypalOrderId, capture_id: captureId });
    return { success: true, orderId: order.id, status };
  }

  @Post('square/payments')
  @HttpCode(200)
  async captureSquare(@Body() body: unknown) {
    const payload = jsonBody(body);
    const orderId = positiveInteger(payload.orderId, 'orderId', Number.MAX_SAFE_INTEGER);
    const sourceId = stringValue(payload.sourceId, 'sourceId', 500);
    const billingEmail = stringValue(payload.email, 'email', 254).toLowerCase();
    const locationId = env('SQUARE_LOCATION_ID');
    if (!locationId) throw new AppError('Square Payments is not configured.', 503);

    const order = await this.db.one<Row>("select * from public.orders where id = $1 and provider = 'square' and billing_email = $2", [orderId, billingEmail]);
    if (!order) throw new AppError('Checkout order not found.', 404);
    if (order.status === 'paid' || order.status === 'preorder_reserved') return { success: true, orderId: order.id, status: order.status };
    if (order.status !== 'pending') throw new AppError('This order can no longer be captured.', 409);
    const lines = await this.db.many('select * from public.order_items where order_id = $1 order by id', [order.id]);

    let squareOrderId: string | null = order.square_order_id;
    if (!squareOrderId) {
      const created = await this.square.request('/v2/orders', {
        order: {
          location_id: locationId,
          reference_id: `spin-hobby-${order.id}`,
          line_items: lines.map((l) => ({ ...(l.square_item_id.startsWith('manual-') ? {} : { catalog_object_id: l.square_variation_id }), name: l.name, quantity: String(l.quantity), base_price_money: { amount: l.unit_price_cents, currency: 'CAD' } })),
          service_charges: [
            ...(order.shipping_cents ? [{ name: 'Shipping', amount_money: { amount: order.shipping_cents, currency: 'CAD' } }] : []),
            ...(order.tax_cents ? [{ name: 'Sales tax', amount_money: { amount: order.tax_cents, currency: 'CAD' } }] : []),
          ],
        },
        idempotency_key: `spin-hobby-order-${order.id}`,
      }, `spin-hobby-order-${order.id}`);
      squareOrderId = created.order?.id ?? null;
      if (!squareOrderId) throw new AppError('Square did not return an order ID.', 502);
      await this.db.exec('update public.orders set square_order_id = $2 where id = $1', [order.id, squareOrderId]);
    }

    const payment = await this.square.request('/v2/payments', {
      source_id: sourceId,
      idempotency_key: `spin-hobby-payment-${order.id}`,
      amount_money: { amount: order.total_cents, currency: 'CAD' },
      order_id: squareOrderId,
      location_id: locationId,
      buyer_email_address: order.billing_email,
      ...(typeof payload.verificationToken === 'string' ? { verification_token: payload.verificationToken } : {}),
    }, `spin-hobby-payment-${order.id}`);
    if (payment.payment?.status !== 'COMPLETED') throw new AppError('Square did not complete this payment.', 402);
    const status = await this.markPaid(order.id, payment.payment.id, payment.payment.receipt_url ?? null,
      { square_order_id: squareOrderId, payment_id: payment.payment.id });
    return { success: true, orderId: order.id, status };
  }

  private async markPaid(orderId: number, paymentId: string, receiptUrl: string | null, data: Row) {
    return this.db.transaction(async (tx) => {
      const preorder = await this.db.one('select 1 from public.order_items where order_id = $1 and is_preorder limit 1', [orderId], tx);
      const status = preorder ? 'preorder_reserved' : 'paid';
      await this.db.exec('update public.orders set status = $2, provider_payment_id = $3, receipt_url = $4 where id = $1', [orderId, status, paymentId, receiptUrl], tx);
      await this.db.exec("insert into public.order_events (order_id, event_type, data) values ($1, 'paid', $2)", [orderId, JSON.stringify(data)], tx);
      return status;
    });
  }
}
