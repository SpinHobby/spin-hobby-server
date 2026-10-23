import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import type { EbayTokenStore, StoredEbayTokens } from '../../integrations/ebay/ebay.client.js';

/** The database side of the eBay client: reads the seller's tokens and saves a refreshed access token (both kept sealed). */
@Injectable()
export class EbayTokensService implements EbayTokenStore {
  constructor(private readonly db: Db) {}

  read(): Promise<StoredEbayTokens | null> {
    return this.db.one<StoredEbayTokens>(
      'select access_token, access_expires_at, refresh_token, refresh_expires_at from public.ebay_connection where id = 1',
    );
  }

  async saveAccess(sealedAccessToken: string, expiresAt: string): Promise<void> {
    await this.db.exec(
      'update public.ebay_connection set access_token = $1, access_expires_at = $2 where id = 1',
      [sealedAccessToken, expiresAt],
    );
  }
}
