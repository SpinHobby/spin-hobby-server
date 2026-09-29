import { Global, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { createMissingDriver, createPgDriver, Db, DB_DRIVER } from './db.service.js';

@Global()
@Module({
  providers: [
    {
      provide: DB_DRIVER,
      useFactory: () => {
        const url = env('DATABASE_URL');
        if (!url) {
          console.error('[Db] DATABASE_URL is not set: database routes will fail until it is. See GET /health.');
          return createMissingDriver();
        }
        return createPgDriver(url);
      },
    },
    Db,
  ],
  exports: [Db],
})
export class DbModule {}
