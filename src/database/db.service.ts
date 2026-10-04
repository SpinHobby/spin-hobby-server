import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { databaseConnectTimeoutMs, databasePoolSize } from '../config/database.config.js';
import { databaseSsl } from '../config/database.config.js';

export type Row = Record<string, any>;

/** Anything that can run a parameterised query: the pool, a transaction client, or PGlite in tests. */
export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs a multi-statement SQL script (simple query protocol), e.g. a migration file. */
  script?(sql: string): Promise<void>;
}

export const DB_DRIVER = Symbol('DB_DRIVER');

export interface DbDriver extends Queryable {
  /** Runs fn inside BEGIN/COMMIT, rolling back on any error. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// Return bigint ids / counts as JS numbers (order ids stay far below 2^53) and
// numeric columns (tax rates, fx) as numbers, matching the edge function's JSON.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
// Plain dates (release_month, event dates) stay "YYYY-MM-DD" - never shifted by the server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
// Timestamps leave as ISO-8601 strings, like PostgREST returned them to the storefront.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (v) => new Date(`${v}Z`).toISOString());

/** Normalises a pasted connection string: trims quotes/whitespace and drops SSL query params (SSL is set below). */
export function cleanConnectionString(raw: string) {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  try {
    const url = new URL(trimmed);
    // pg treats sslmode=require as verify-full, which rejects Supabase's certificate chain.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl'])
      url.searchParams.delete(key);
    return url.toString();
  } catch {
    return trimmed; // not a URL; let pg report the problem
  }
}

export function createPgDriver(connectionString: string): DbDriver {
  const pool = new pg.Pool({
    connectionString: cleanConnectionString(connectionString),
    max: databasePoolSize(),
    connectionTimeoutMillis: databaseConnectTimeoutMs(),
    ssl: databaseSsl() ? { rejectUnauthorized: false } : undefined,
  });
  // Idle client errors (e.g. the pooler restarting) must not crash the process.
  pool.on('error', (error) => new Logger('Db').error(`idle client error: ${error.message}`));
  return {
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    script: async (sql) => {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({
          query: (sql, params) => client.query(sql, params as any[]) as any,
          script: async (sql) => {
            await client.query(sql);
          }, // no values -> simple protocol, multi-statement OK
        });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Used when DATABASE_URL is missing: the API still boots so /health can explain what's wrong. */
export function createMissingDriver(): DbDriver {
  const fail = () =>
    Promise.reject(
      Object.assign(new Error('DATABASE_URL is not set.'), { code: 'CONFIG_MISSING' }),
    );
  return {
    query: fail as DbDriver['query'],
    transaction: fail as DbDriver['transaction'],
    close: async () => undefined,
  };
}

@Injectable()
export class Db implements OnModuleDestroy {
  private readonly logger = new Logger(Db.name);
  constructor(@Inject(DB_DRIVER) private readonly driver: DbDriver) {}

  async many<T extends Row = Row>(
    sql: string,
    params: unknown[] = [],
    tx?: Queryable,
  ): Promise<T[]> {
    return (await (tx ?? this.driver).query<T>(sql, params)).rows;
  }

  async one<T extends Row = Row>(
    sql: string,
    params: unknown[] = [],
    tx?: Queryable,
  ): Promise<T | null> {
    return (await this.many<T>(sql, params, tx))[0] ?? null;
  }

  async exec(sql: string, params: unknown[] = [], tx?: Queryable): Promise<void> {
    await (tx ?? this.driver).query(sql, params);
  }

  async script(sql: string, tx?: Queryable): Promise<void> {
    const target = tx ?? this.driver;
    if (!target.script) throw new Error('This database driver cannot run SQL scripts.');
    await target.script(sql);
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.driver.transaction(fn);
  }

  async onModuleDestroy() {
    await this.driver.close().catch((e) => this.logger.warn(`Closing database: ${e}`));
  }
}
