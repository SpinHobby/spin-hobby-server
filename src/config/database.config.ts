import { join } from 'node:path';
import { env, envNumber } from './env.js';

/** Postgres connection string. Required (the server cannot run without a database). */
export const databaseUrl = () => env('DATABASE_URL');

/** Connections kept open to Postgres. */
export const databasePoolSize = () => envNumber('DATABASE_POOL_SIZE', 10);

/** How long to wait for a free connection before giving up. */
export const databaseConnectTimeoutMs = () => envNumber('DATABASE_CONNECT_TIMEOUT_MS', 10_000);

/** TLS to Postgres (on by default; `DATABASE_SSL=false` for a local database). */
export const databaseSsl = () => env('DATABASE_SSL') !== 'false';

/** Where the SQL migration files live. */
export const migrationsDir = () =>
  env('MIGRATIONS_DIR') ?? join(process.cwd(), 'supabase', 'migrations');

/** Run pending migrations when the server starts (default on). */
export const migrateOnStart = () => env('MIGRATE_ON_START') !== 'false';
