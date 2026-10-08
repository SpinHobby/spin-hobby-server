import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { stringValue } from '../../common/validation/rules.js';
import { Db } from '../../database/db.service.js';
import { PayPalClient } from '../../integrations/paypal/paypal.client.js';
import { SquareSyncService } from '../square-sync/square-sync.service.js';
import { squareSignatureValid } from './square-signature.js';
import { squareWebhookSignatureKey, squareWebhookUrl } from '../../config/square.config.js';
import type { ExternalJson } from '../../common/external-json.js';

/**
 * Receives notifications from Square and PayPal. Every delivery is checked against the provider's signature,
 * and stored by its event id so a retried delivery is recognised and ignored. Both methods answer
 * `{ duplicate: true }` for an event they have already seen.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: Db,
    private readonly paypal: PayPalClient,
    private readonly squareSync: SquareSyncService,
  ) {}

  /** Stores the event. Returns true when this event id was already stored (the provider retried). */
  private async alreadySeen(
    id: string,
    provider: string,
    type: string,
    payload: unknown,
    processed: boolean,
  ) {
    const inserted = await this.db.one<{ id: string }>(
      `insert into public.webhook_events (id, provider, event_type, payload, processed_at)
       values ($1, $2, $3, $4, ${processed ? 'now()' : 'null'}) on conflict (id) do nothing returning id`,
      [id, provider, type, JSON.stringify(payload)],
    );
    return !inserted;
  }

  /** Square: when stock counts change, copy the new absolute counts into our inventory snapshots. */
  async receiveSquare(raw: string, signature: string | undefined) {
    const valid = squareSignatureValid(
      raw,
      signature,
      squareWebhookSignatureKey(),
      squareWebhookUrl(),
    );
    if (!valid) throw new AppError('Invalid Square webhook signature.', 401);
    const event = JSON.parse(raw) as ExternalJson;
    const eventId = stringValue(event.event_id, 'event_id', 200);
    if (await this.alreadySeen(eventId, 'square', event.type ?? 'unknown', event, false))
      return { duplicate: true };

    const counts = event.data?.object?.inventory_counts;
    if (event.type === 'inventory.count.updated' && Array.isArray(counts)) {
      await this.applyInventoryCounts(counts, event.created_at ?? new Date().toISOString());
    }
    // Something in the catalog changed in Square (an item added, edited, hidden or deleted): refresh soon.
    if (event.type === 'catalog.version.updated') this.squareSync.requestSync();
    await this.db.exec('update public.webhook_events set processed_at = now() where id = $1', [
      eventId,
    ]);
    return { duplicate: false };
  }

  /** Square sends absolute counts. Only in-stock counts for variations we know about are applied. */
  private async applyInventoryCounts(counts: ExternalJson[], at: string) {
    const inStock = counts.filter(
      (c) => c.catalog_object_id && (!c.state || c.state === 'IN_STOCK'),
    );
    for (const count of inStock) {
      await this.db.exec(
        `insert into public.inventory_snapshots (square_variation_id, quantity, square_updated_at, synced_at)
         select $1, $2, $3, now() where exists (select 1 from public.catalog_variations where square_variation_id = $1)
         on conflict (square_variation_id) do update set quantity = excluded.quantity, square_updated_at = excluded.square_updated_at, synced_at = now()`,
        [
          count.catalog_object_id,
          count.quantity === undefined ? null : Math.max(0, Number(count.quantity)),
          at,
        ],
      );
    }
  }

  /** PayPal: verified with PayPal's own API, then just recorded (payments are captured by the checkout flow). */
  async receivePayPal(raw: string, requestHeaders: Record<string, string | string[] | undefined>) {
    const event = JSON.parse(raw) as ExternalJson;
    const headers = Object.fromEntries(
      Object.entries(requestHeaders).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
    if (!(await this.paypal.verifyWebhook(headers, event)))
      throw new AppError('Invalid PayPal webhook signature.', 401);
    const id = stringValue(event.id, 'id', 200);
    if (await this.alreadySeen(id, 'paypal', event.event_type ?? 'unknown', event, true))
      return { duplicate: true };
    this.logger.log(`PayPal webhook ${event.event_type} stored`);
    return { duplicate: false };
  }
}
