import { Injectable } from '@nestjs/common';
import { Db, type Queryable } from '../../database/db.service.js';
import type { StoreSettingsRow } from '../../database/rows.js';

@Injectable()
export class StoreService {
  constructor(private readonly db: Db) {}

  async settings(tx?: Queryable): Promise<StoreSettingsRow> {
    const row = await this.db.one<StoreSettingsRow>(
      'select * from public.store_settings where id = true',
      [],
      tx,
    );
    if (!row) throw new Error('store_settings row is missing - run the Supabase migrations.');
    return row;
  }
}
