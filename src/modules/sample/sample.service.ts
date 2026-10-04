import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PRODUCTION_SUPABASE_REF } from '../auth/staging-admin.js';
import { Db, type Queryable } from '../../database/db.service.js';
import { MigrationService } from '../../database/migrations/migration.service.js';
import { countProducts, seedSample, type SampleDb } from './seed.js';
import { isProduction, isStaging } from '../../config/app.config.js';
import { supabaseUrl } from '../../config/supabase.config.js';
import { sampleDataDisabled, sampleImageBase } from '../../config/app.config.js';

/** Sample pictures are served everywhere except production (where the sample catalog is never loaded). */
export const sampleImagesEnabled = () => isStaging() || !isProduction();

/**
 * Staging only: loads the sample catalog into an empty database on start, right after migrations,
 * so a fresh staging deployment has products, categories, banners and orders to test with and
 * nobody has to run anything by hand. SAMPLE_DATA=false turns it off. Never touches the
 * production Supabase project, whatever APP_ENV says.
 */
@Injectable()
export class SampleDataService implements OnModuleInit {
  private readonly logger = new Logger(SampleDataService.name);

  constructor(
    private readonly db: Db,
    private readonly migrations: MigrationService,
  ) {}

  async onModuleInit() {
    if (!isStaging() || sampleDataDisabled()) return;
    if (supabaseUrl()?.includes(PRODUCTION_SUPABASE_REF)) {
      this.logger.warn('Sample data skipped: SUPABASE_URL is the production project.');
      return;
    }
    const migrations = await this.migrations.ready;
    if (migrations.state === 'failed') {
      this.logger.warn('Sample data skipped: migrations failed.');
      return;
    }
    const adapter = (tx?: Queryable): SampleDb => ({
      query: async (sql, params = []) => ({ rows: await this.db.many(sql, params, tx) }),
    });
    try {
      if ((await countProducts(adapter())) > 0) return;
      const base = sampleImageBase();
      const seeded = await this.db.transaction((tx) => seedSample(adapter(tx), base));
      this.logger.log(
        `Sample catalog loaded: ${seeded.products} products, ${seeded.categories} categories, ${seeded.orders} orders, ${seeded.slides} banners (pictures from ${base}/sample-images).`,
      );
    } catch (error) {
      this.logger.error(`Sample data failed: ${(error as Error).message.split('\n')[0]}`);
    }
  }
}
