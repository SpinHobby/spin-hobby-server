import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';

/** "Email me when this is back in stock": works for guests (email only) and signed-in customers. */
@Injectable()
export class RestockAlertService {
  constructor(private readonly db: Db) {}

  /** Signing up again re-arms an alert that was already sent. */
  async subscribe(email: string, variationId: string, userId: string | null) {
    const variation = await this.db.one(
      'select 1 from public.catalog_variations where square_variation_id = $1',
      [variationId],
    );
    if (!variation) throw new AppError('This product variation is not available.');
    await this.db.exec(
      `insert into public.stock_alerts (email, square_variation_id, user_id, notified_at)
       values ($1, $2, $3, null)
       on conflict (email, square_variation_id) do update set user_id = coalesce(excluded.user_id, stock_alerts.user_id), notified_at = null`,
      [email, variationId, userId],
    );
  }
}
