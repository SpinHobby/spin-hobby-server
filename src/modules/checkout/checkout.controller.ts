import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { QuoteService } from '../orders/quote.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { CheckoutConfigService } from './checkout-config.service.js';
import { CheckoutIntentDto } from './dto/checkout-intent.dto.js';
import { PayPalCaptureDto } from './dto/paypal-capture.dto.js';
import { QuoteRequestDto } from './dto/quote-request.dto.js';
import { SquarePaymentDto } from './dto/square-payment.dto.js';
import { TestPaymentDto } from './dto/test-payment.dto.js';

/** The shopper's checkout, in order: read the config, price the cart, create the order, then pay. */
@ApiTags('Checkout')
@Controller()
export class CheckoutController {
  constructor(
    private readonly config: CheckoutConfigService,
    private readonly quotes: QuoteService,
    private readonly payments: PaymentsService,
  ) {}

  /** Public, non-secret values the checkout page needs to render the active payment method. */
  @Get('checkout/config')
  publicConfig() {
    return this.config.publicConfig();
  }

  /** Prices a cart on the server (never trust browser prices): stock, limits, shipping and tax. */
  @RateLimit({ limit: 60, windowMs: 60_000 })
  @Post('cart/quote')
  @HttpCode(200)
  async quote(@Body() dto: QuoteRequestDto) {
    return { success: true, ...(await this.quotes.quote(dto)) };
  }

  /**
   * Creates the order and holds its stock. Answers 409 `CART_CHANGED` with a fresh quote when prices or
   * stock moved since the shopper last saw them.
   */
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('checkout/intent')
  @HttpCode(200)
  async intent(@CurrentUser() user: AppUser | null, @Body() dto: CheckoutIntentDto) {
    const started = await this.payments.start(
      dto.quote,
      { email: dto.email, billing: dto.billing, shipping: dto.shipping },
      user,
    );
    return { success: true, ...started };
  }

  /** Completes a PayPal payment for an order created by `checkout/intent`. */
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @Post('paypal/capture')
  @HttpCode(200)
  async capturePayPal(@Body() dto: PayPalCaptureDto) {
    return { success: true, ...(await this.payments.capturePayPal(dto.paypalOrderId)) };
  }

  /** Completes an order with a test payment, on a local copy of the shop with no payment keys only (404 anywhere else). */
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @Post('checkout/test-payment')
  @HttpCode(200)
  async captureTest(@Body() dto: TestPaymentDto) {
    return { success: true, ...(await this.payments.captureTest(dto.orderId, dto.email)) };
  }

  /** Charges a card through Square for an order created by `checkout/intent`. */
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('square/payments')
  @HttpCode(200)
  async captureSquare(@Body() dto: SquarePaymentDto) {
    return {
      success: true,
      ...(await this.payments.captureSquare(
        dto.orderId,
        dto.email,
        dto.sourceId,
        dto.verificationToken,
      )),
    };
  }
}
