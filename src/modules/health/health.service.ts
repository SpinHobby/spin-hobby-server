import { Injectable } from '@nestjs/common';
import { env } from '../../config/env.js';
import { Db } from '../../database/db.service.js';
import { MigrationService } from '../../database/migrations/migration.service.js';
import { stagingAdmin } from '../auth/staging-admin.js';
import { explainDbError } from './db-error.js';

type Check = { ok: boolean; [key: string]: unknown };

/** Settings the API cannot run without. */
const REQUIRED = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
/** Integrations that are switched on by their settings; reported, but never fail readiness. */
const OPTIONAL: Record<string, string[]> = {
  paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  square: ['SQUARE_ACCESS_TOKEN', 'SQUARE_APPLICATION_ID', 'SQUARE_LOCATION_ID'],
  email: ['RESEND_API_KEY', 'FROM_EMAIL'],
  cashierAi: ['ANTHROPIC_API_KEY'],
};
/** Tables the current code relies on (one per migration, newest last). */
const TABLES = [
  'profiles',
  'store_settings',
  'catalog_products',
  'hero_slides',
  'ai_usage_log',
  'store_categories',
];

/** Gives a slow dependency 12 seconds to answer, so the health check itself can never hang. */
async function timed<T>(fn: () => Promise<T>, ms = 12_000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms),
    ),
  ]);
}

/**
 * Is the API healthy, and if not, why? Each check answers `{ ok, ...details }` with a hint for the
 * person debugging a deployment. Readiness depends on config, database, schema and auth; storage,
 * migrations and the optional integrations are reported for information.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly db: Db,
    private readonly migrations: MigrationService,
  ) {}

  /** `npm run dev:local`: no Supabase at all; sign-in and uploads are simulated locally. */
  private get localDev() {
    return env('NODE_ENV') !== 'production' && env('AUTH_DEV_LOGIN') === 'true';
  }

  async report() {
    const checks: Record<string, Check> = {};
    checks.config = this.config();
    checks.database = await this.database();
    checks.schema = checks.database.ok
      ? await this.schema()
      : { ok: false, error: 'database_unavailable' };
    checks.migrations = this.migrationStatus(checks.schema);
    checks.auth = await this.auth();
    checks.storage = await this.storage();

    const ok = ['config', 'database', 'schema', 'auth'].every((name) => checks[name].ok);
    return {
      ok,
      body: {
        success: ok,
        status: ok ? 'ok' : 'degraded',
        checks,
        integrations: this.integrations(),
        environment: env('APP_ENV') ?? 'production',
        version: env('RENDER_GIT_COMMIT')?.slice(0, 7) ?? null,
        time: new Date().toISOString(),
      },
    };
  }

  private config(): Check {
    const missing = REQUIRED.filter((k) => !env(k) && !(this.localDev && k !== 'DATABASE_URL'));
    return { ok: missing.length === 0, missing };
  }

  private async database(): Promise<Check> {
    const started = Date.now();
    try {
      await timed(() => this.db.one('select 1 as ok'));
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, ...explainDbError(error) };
    }
  }

  /** Are the tables the code relies on there? */
  private async schema(): Promise<Check> {
    try {
      const rows = await this.db.many<{ name: string; present: boolean }>(
        'select t as name, to_regclass($1 || t) is not null as present from unnest($2::text[]) t',
        ['public.', TABLES],
      );
      const missingTables = rows.filter((r) => !r.present).map((r) => r.name);
      return {
        ok: missingTables.length === 0,
        missingTables,
        ...(missingTables.length
          ? {
              hint: 'Apply the migrations in supabase/migrations (the server does this on start when migration history exists).',
            }
          : {}),
      };
    } catch (error) {
      return { ok: false, ...explainDbError(error) };
    }
  }

  private migrationStatus(schema: Check): Check {
    const status = this.migrations.status;
    return {
      ok: status.state === 'ok' || (status.state === 'skipped' && schema.ok === true),
      ...status,
    };
  }

  /** Can we reach Supabase Auth with our key, and which sign-in methods does it offer? */
  private async auth(): Promise<Check> {
    const url = env('SUPABASE_URL')?.replace(/\/$/, '');
    const key = env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY');
    if (this.localDev) return { ok: true, mode: 'local-dev-login' };
    if (!url || !key) {
      return {
        ok: false,
        error: 'not_configured',
        hint: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.',
      };
    }
    try {
      const res = await timed(() => fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }));
      if (!res.ok) {
        return {
          ok: false,
          error: res.status === 401 ? 'key_rejected' : `http_${res.status}`,
          hint: 'Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY belong to the same project.',
        };
      }
      const settings = (await res.json()) as { external?: Record<string, boolean> };
      return {
        ok: true,
        password: Boolean(settings.external?.email),
        google: Boolean(settings.external?.google),
        discord: Boolean(settings.external?.discord),
        ...(stagingAdmin() && { stagingAdmin: true }),
      };
    } catch {
      return { ok: false, error: 'unreachable', hint: 'SUPABASE_URL could not be reached.' };
    }
  }

  /** Can the admin upload photos? (The product-images bucket exists and our key may use it.) */
  private async storage(): Promise<Check> {
    const url = env('SUPABASE_URL')?.replace(/\/$/, '');
    const service = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
    if (this.localDev && (!url || !service)) return { ok: true, mode: 'local-disk' };
    if (!url || !service) {
      return {
        ok: false,
        error: 'not_configured',
        hint: 'Set SUPABASE_SERVICE_ROLE_KEY for photo uploads.',
      };
    }
    try {
      const res = await timed(() =>
        fetch(`${url}/storage/v1/bucket/product-images`, {
          headers: { Authorization: `Bearer ${service}`, apikey: service },
        }),
      );
      if (res.ok) return { ok: true };
      const missing = res.status === 404 || res.status === 400;
      return {
        ok: false,
        error: missing
          ? 'bucket_missing'
          : res.status === 401 || res.status === 403
            ? 'key_rejected'
            : `http_${res.status}`,
        hint: missing
          ? 'The product-images bucket is created by migration 20260929120000.'
          : 'Check SUPABASE_SERVICE_ROLE_KEY.',
      };
    } catch {
      return { ok: false, error: 'unreachable' };
    }
  }

  /** Which optional integrations have all their settings. */
  private integrations() {
    return Object.fromEntries(
      Object.entries(OPTIONAL).map(([name, keys]) => [
        name,
        keys.every((k) => env(k)) ? 'configured' : 'not_configured',
      ]),
    );
  }
}
