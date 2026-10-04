import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { AppError } from '../common/errors.js';
import { SkipRateLimit } from '../common/rate-limit.js';
import { stringValue } from '../common/validation.js';
import { env } from '../config/env.js';
import { Db, type Row } from '../db/db.service.js';
import { PayPalClient } from '../payments/paypal.client.js';

@SkipRateLimit()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(
    private readonly db: Db,
    private readonly paypal: PayPalClient,
  ) {}

  /** Square signs notification URL + raw body with HMAC-SHA256 (base64). */
  static squareSignatureValid(
    raw: string,
    signature: string | undefined,
    key: string | undefined,
    url: string | undefined,
  ) {
    if (!signature || !key || !url) return false;
    const expected = createHmac('sha256', key)
      .update(url + raw)
      .digest();
    const given = Buffer.from(signature, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** Returns true when this event id was already stored (Square/PayPal retry deliveries). */
  private async record(
    id: string,
    provider: string,
    type: string,
    payload: unknown,
    processed: boolean,
  ) {
    const inserted = await this.db.one(
      `insert into public.webhook_events (id, provider, event_type, payload, processed_at)
       values ($1, $2, $3, $4, ${processed ? 'now()' : 'null'}) on conflict (id) do nothing returning id`,
      [id, provider, type, JSON.stringify(payload)],
    );
    return !inserted;
  }

  @Post('square')
  @HttpCode(200)
  async square(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-square-hmacsha256-signature') signature?: string,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (
      !WebhooksController.squareSignatureValid(
        raw,
        signature,
        env('SQUARE_WEBHOOK_SIGNATURE_KEY'),
        env('SQUARE_WEBHOOK_URL'),
      )
    ) {
      throw new AppError('Invalid Square webhook signature.', 401);
    }
    const event = JSON.parse(raw) as Row;
    const eventId = stringValue(event.event_id, 'event_id', 200);
    if (await this.record(eventId, 'square', event.type ?? 'unknown', event, false))
      return { success: true, duplicate: true };

    const counts = event.data?.object?.inventory_counts;
    if (event.type === 'inventory.count.updated' && Array.isArray(counts)) {
      for (const count of counts.filter(
        (c: Row) => c.catalog_object_id && (!c.state || c.state === 'IN_STOCK'),
      )) {
        await this.db.exec(
          `insert into public.inventory_snapshots (square_variation_id, quantity, square_updated_at, synced_at)
           select $1, $2, $3, now() where exists (select 1 from public.catalog_variations where square_variation_id = $1)
           on conflict (square_variation_id) do update set quantity = excluded.quantity, square_updated_at = excluded.square_updated_at, synced_at = now()`,
          [
            count.catalog_object_id,
            count.quantity === undefined ? null : Math.max(0, Number(count.quantity)),
            event.created_at ?? new Date().toISOString(),
          ],
        );
      }
    }
    await this.db.exec('update public.webhook_events set processed_at = now() where id = $1', [
      eventId,
    ]);
    return { success: true };
  }

  @Post('paypal')
  @HttpCode(200)
  async paypalHook(@Req() req: RawBodyRequest<Request>) {
    const raw = req.rawBody?.toString('utf8') ?? '{}';
    const event = JSON.parse(raw) as Row;
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
    if (!(await this.paypal.verifyWebhook(headers, event)))
      throw new AppError('Invalid PayPal webhook signature.', 401);
    const id = stringValue(event.id, 'id', 200);
    if (await this.record(id, 'paypal', event.event_type ?? 'unknown', event, true))
      return { success: true, duplicate: true };
    this.logger.log(`PayPal webhook ${event.event_type} stored`);
    return { success: true };
  }
}
