import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { StoreService } from '../../store/store.service.js';
import { AdminLog } from '../admin-log.service.js';
import { sentFields } from '../dto/defined-fields.js';
import type { TaxRateDto } from './dto/tax-rate.dto.js';
import type { UpdateSettingsDto } from './dto/update-settings.dto.js';
import type { StoreSettingsRow, TaxRateRow } from '../../../database/rows.js';

/** Shop-wide settings and provincial tax rates. */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly db: Db,
    private readonly store: StoreService,
    private readonly log: AdminLog,
  ) {}

  get() {
    return this.store.settings();
  }

  /** Applies only the fields that were sent. Returns the settings as they are afterwards. */
  async update(adminId: string, dto: UpdateSettingsDto) {
    const changes = sentFields(dto);
    const keys = Object.keys(changes);
    const current = await this.store.settings();
    if (!keys.length) return current;
    const min = Number(changes.handling_days_min ?? current.handling_days_min);
    const max = Number(changes.handling_days_max ?? current.handling_days_max);
    if (max < min) throw new AppError('Handling max must be at least the min.');
    return this.db.transaction(async (tx) => {
      const row = await this.db.one<StoreSettingsRow>(
        `update public.store_settings set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id = true returning *`,
        keys.map((k) => changes[k]),
        tx,
      );
      await this.log.write(adminId, 'settings.updated', 'store', changes, tx);
      return row;
    });
  }

  taxRates() {
    return this.db.many<TaxRateRow>('select * from public.tax_rates order by country, province');
  }

  /** Adds or replaces the rate for one province or state. */
  async setTaxRate(adminId: string, dto: TaxRateDto) {
    const taxRate = await this.db.one<TaxRateRow>(
      `insert into public.tax_rates (country, province, rate, enabled) values ($1, $2, $3, $4)
       on conflict (country, province) do update set rate = excluded.rate, enabled = excluded.enabled returning *`,
      [dto.country, dto.province, dto.rate, dto.enabled],
    );
    await this.log.write(adminId, 'tax_rate.updated', `${dto.country}/${dto.province}`, {
      rate: dto.rate,
      enabled: dto.enabled,
    });
    return taxRate;
  }
}
