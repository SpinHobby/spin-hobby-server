import { Global, Module } from '@nestjs/common';
import { env } from '../config/env.js';
import { createPgDriver, Db, DB_DRIVER } from './db.service.js';

@Global()
@Module({
  providers: [
    {
      provide: DB_DRIVER,
      useFactory: () => {
        const url = env('DATABASE_URL');
        if (!url) throw new Error('DATABASE_URL is required (the Supabase Postgres connection string).');
        return createPgDriver(url);
      },
    },
    Db,
  ],
  exports: [Db],
})
export class DbModule {}
