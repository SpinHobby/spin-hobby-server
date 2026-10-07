import { Injectable } from '@nestjs/common';
import { Db } from '../../../database/db.service.js';
import { SquareSyncService } from '../../square-sync/square-sync.service.js';
import { StoreService } from '../../store/store.service.js';
import { AdminLog } from '../admin-log.service.js';
import {
  squareAccessToken,
  squareIsProduction,
  squareLocationId,
  squareWebhookSignatureKey,
  squareWebhookUrl,
} from '../../../config/square.config.js';

/** Is Square connected, and run a catalog sync now. */
@Injectable()
export class AdminSquareService {
  constructor(
    private readonly db: Db,
    private readonly store: StoreService,
    private readonly sync: SquareSyncService,
    private readonly log: AdminLog,
  ) {}

  /** A checklist for the admin sidebar and settings screen. */
  async readiness() {
    const [catalog, settings] = await Promise.all([
      // Only items that came from Square count: sample and hand-entered products carry a timestamp too, but nothing was synced.
      this.db.one<{ synced_at: string | null }>(
        "select max(synced_at) as synced_at from public.catalog_products where source = 'square'",
      ),
      this.store.settings(),
    ]);
    return {
      appAndLocationConnected: Boolean(squareAccessToken() && squareLocationId()),
      catalogAndInventorySyncing: Boolean(catalog?.synced_at),
      webhookKeySet: Boolean(squareWebhookSignatureKey() && squareWebhookUrl()),
      /** Real cards are charged: Square is in live (production) mode, not the sandbox. */
      liveMode: squareIsProduction(),
      /** The card form asks the shopper's bank for 3-D Secure (Square's verifyBuyer) and the server passes the result to Square. */
      threeDSecureEnabled: true,
      activeProvider: settings.payment_provider,
      lastSyncAt: catalog?.synced_at ?? null,
    };
  }

  /** Runs the catalog and inventory sync in-process (no separate service to call). */
  async runSync(adminId: string) {
    const result = await this.sync.run();
    await this.log.write(adminId, 'square.sync_completed', 'catalog', { ...result });
    return result;
  }
}
