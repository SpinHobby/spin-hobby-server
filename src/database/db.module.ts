import { Global, Logger, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { createMissingDriver, createPgDriver, Db, DB_DRIVER } from './db.service.js';
import { MigrationService } from './migrations/migration.service.js';

/**
 * The Postgres connection (`Db`) and the migration runner. Global, so every module can inject `Db`
 * without importing this one.
 */
@Global()
@Module({
  providers: [
    {
      provide: DB_DRIVER,
      useFactory: () => {
        const url = env('DATABASE_URL');
        if (!url) {
          new Logger('Db').error(
            'DATABASE_URL is not set: database routes will fail until it is. See GET /health.',
          );
          return createMissingDriver();
        }
        return createPgDriver(url);
      },
    },
    Db,
    MigrationService, // applies supabase/migrations on boot, and reports status to /health
  ],
  exports: [Db, MigrationService],
})
export class DbModule {}
