import { Controller, Headers, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { SkipRateLimit } from '../../common/guards/rate-limit.guard.js';
import { WebhooksService } from './webhooks.service.js';

/** The reply providers expect: 200, with `duplicate: true` when the event was a retry. */
const reply = ({ duplicate }: { duplicate: boolean }) => ({
  success: true,
  ...(duplicate && { duplicate }),
});

/**
 * Inbound webhooks. Signatures are computed over the exact bytes the provider sent, so these routes read
 * the raw body (enabled in main.ts). Not rate limited, and hidden from the API docs: only Square and PayPal call them.
 */
@ApiExcludeController()
@SkipRateLimit()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('square')
  @HttpCode(200)
  async square(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-square-hmacsha256-signature') signature?: string,
  ) {
    return reply(await this.webhooks.receiveSquare(req.rawBody?.toString('utf8') ?? '', signature));
  }

  @Post('paypal')
  @HttpCode(200)
  async paypal(@Req() req: RawBodyRequest<Request>) {
    return reply(
      await this.webhooks.receivePayPal(req.rawBody?.toString('utf8') ?? '{}', req.headers),
    );
  }
}
