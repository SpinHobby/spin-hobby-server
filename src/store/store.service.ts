import { Injectable } from '@nestjs/common';
import { Db, type Queryable, type Row } from '../db/db.service.js';

export interface StoreSettings {
  payment_provider: 'paypal' | 'square';
  shipping_standard_cents: number;
  shipping_express_cents: number;
  free_shipping_threshold_cents: number;
  low_stock_threshold: number;
  fx_cad_usd: number;
  handling_days_min: number;
  handling_days_max: number;
  maintenance_mode: boolean;
  maintenance_message: string | null;
  updated_at: string;
}

@Injectable()
export class StoreService {
  constructor(private readonly db: Db) {}

  async settings(tx?: Queryable): Promise<StoreSettings> {
    const row = await this.db.one<StoreSettings & Row>('select * from public.store_settings where id = true', [], tx);
    if (!row) throw new Error('store_settings row is missing - run the Supabase migrations.');
    return row;
  }
}
