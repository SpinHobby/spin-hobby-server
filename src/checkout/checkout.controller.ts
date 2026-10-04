import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AppError } from '../common/errors.js';
import { RateLimit } from '../common/rate-limit.js';
import {
  email as validEmail,
  jsonBody,
  positiveInteger,
  stringValue,
  type Json,
} from '../common/validation.js';
import { env, paypalIsLive, squareEnvIsProduction } from '../config/env.js';
import { PaymentsService } from '../payments/payments.service.js';
import { StoreService } from '../store/store.service.js';
import { parseQuoteInput, QuoteService } from './quote.service.js';

@Controller()
export class CheckoutController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly store: StoreService,
    private readonly payments: PaymentsService,
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
      maintenanceMode: s.maintenance_mode,
      maintenanceMessage: s.maintenance_message,
    };
  }

  @RateLimit({ limit: 60, windowMs: 60_000 })
  @Post('cart/quote')
  @HttpCode(200)
  async quote(@Body() body: unknown) {
    return { success: true, ...(await this.quotes.quote(parseQuoteInput(jsonBody(body)))) };
  }

  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('checkout/intent')
  @HttpCode(200)
  async intent(@CurrentUser() user: AppUser | null, @Body() body: unknown) {
    const payload = jsonBody(body);
    const rawQuote = (payload.quoteInput ?? payload.quote) as Json;
    if (!rawQuote || typeof rawQuote !== 'object' || Array.isArray(rawQuote))
      throw new AppError('quoteInput is required.');
    const email = validEmail(payload.email);
    if (
      !payload.billing ||
      typeof payload.billing !== 'object' ||
      !payload.shipping ||
      typeof payload.shipping !== 'object'
    ) {
      throw new AppError('Billing and shipping addresses are required.');
    }
    const started = await this.payments.start(
      parseQuoteInput(rawQuote),
      { email, billing: payload.billing, shipping: payload.shipping },
      user,
    );
    return { success: true, ...started };
  }

  @RateLimit({ limit: 20, windowMs: 60_000 })
  @Post('paypal/capture')
  @HttpCode(200)
  async capturePayPal(@Body() body: unknown) {
    const paypalOrderId = stringValue(jsonBody(body).paypalOrderId, 'paypalOrderId', 200);
    return { success: true, ...(await this.payments.capturePayPal(paypalOrderId)) };
  }

  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('square/payments')
  @HttpCode(200)
  async captureSquare(@Body() body: unknown) {
    const payload = jsonBody(body);
    const orderId = positiveInteger(payload.orderId, 'orderId', Number.MAX_SAFE_INTEGER);
    const sourceId = stringValue(payload.sourceId, 'sourceId', 500);
    const email = stringValue(payload.email, 'email', 254).toLowerCase();
    const verificationToken =
      typeof payload.verificationToken === 'string' ? payload.verificationToken : undefined;
    return {
      success: true,
      ...(await this.payments.captureSquare(orderId, email, sourceId, verificationToken)),
    };
  }
}
