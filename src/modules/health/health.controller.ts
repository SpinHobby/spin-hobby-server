import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { stagingAdmin } from '../auth/staging-admin.js';
import { SkipRateLimit } from '../../common/guards/rate-limit.guard.js';
import { env } from '../../config/env.js';
import { Db } from '../../database/db.service.js';
import { MigrationService } from '../../database/migrations/migration.service.js';

type Check = { ok: boolean; [key: string]: unknown };

const REQUIRED = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const OPTIONAL: Record<string, string[]> = {
  paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  square: ['SQUARE_ACCESS_TOKEN', 'SQUARE_APPLICATION_ID', 'SQUARE_LOCATION_ID'],
  email: ['RESEND_API_KEY', 'FROM_EMAIL'],
  cashierAi: ['ANTHROPIC_API_KEY'],
};
// Tables the current code relies on (one per migration, newest last).
const TABLES = [
  'profiles',
  'store_settings',
  'catalog_products',
  'hero_slides',
  'ai_usage_log',
  'store_categories',
];

/** First line of a DB error with anything URL- or credential-shaped removed. */
export function safeDetail(message: string) {
  return message
    .split('\n')[0]
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/(password|secret|key|token)=\S+/gi, '$1=<hidden>')
    .slice(0, 200);
}

/** Turns a Postgres/network error into a safe, actionable reason (never echoes the connection string). */
export function explainDbError(error: unknown): { error: string; hint: string; detail?: string } {
  const e = error as { code?: string; message?: string };
  const msg = e?.message ?? '';
  const table: [RegExp | string, string, string][] = [
    [
      'CONFIG_MISSING',
      'not_configured',
      'Set DATABASE_URL to the Supabase Session pooler connection string.',
    ],
    [
      'ENOTFOUND',
      'host_not_found',
      'The host in DATABASE_URL does not exist. Copy the Session pooler string from Supabase > Connect.',
    ],
    [
      'ENETUNREACH',
      'host_unreachable',
      'The host is IPv6-only (Supabase direct connection). Use the Session pooler string (aws-0-<region>.pooler.supabase.com).',
    ],
    [
      'EHOSTUNREACH',
      'host_unreachable',
      'The host is unreachable. Use the Supabase Session pooler string.',
    ],
    [
      'ECONNREFUSED',
      'connection_refused',
      'The port refused the connection. The Session pooler uses port 5432.',
    ],
    [
      'ETIMEDOUT',
      'timeout',
      'Connecting timed out. Check the host/port, or that the Supabase project is not paused.',
    ],
    [
      '28P01',
      'password_rejected',
      'Password rejected. Reset it in Supabase > Project Settings > Database and URL-encode special characters (@ -> %40).',
    ],
    [
      '28000',
      'login_rejected',
      'Login rejected. The pooler username must be postgres.<project-ref>.',
    ],
    ['3D000', 'database_not_found', 'Database name not found. It should be /postgres.'],
    [
      /circuit breaker|too many authentication/i,
      'blocked_after_failed_logins',
      'The Supabase pooler is temporarily blocking this user after repeated failed logins. Fix the password, then wait ~5-15 minutes (or restart the pooler from Supabase > Project Settings > Database).',
    ],
    [
      /max client connections|too many clients|remaining connection slots/i,
      'too_many_connections',
      'Connection limit reached. Lower DATABASE_POOL_SIZE (e.g. 5) or use the Transaction pooler (port 6543).',
    ],
    [
      /tenant or user not found/i,
      'pooler_user_wrong',
      'Pooler rejected the user. The username must be postgres.zmlltsytckexrmybvnof (with the project ref).',
    ],
    [
      /password authentication failed/i,
      'password_rejected',
      'Password rejected. Reset it in Supabase > Project Settings > Database and URL-encode special characters.',
    ],
    [
      /self[- ]signed|certificate/i,
      'ssl_error',
      'SSL certificate error. Remove sslmode from DATABASE_URL (the server enables SSL itself).',
    ],
    [
      /timeout/i,
      'timeout',
      'Connecting timed out. Check the host/port, or that the Supabase project is not paused.',
    ],
    [
      /invalid url|invalid connection string|Invalid URL/i,
      'invalid_url',
      'DATABASE_URL is not a valid postgresql:// URL.',
    ],
  ];
  for (const [match, error, hint] of table) {
    if (typeof match === 'string' ? e?.code === match : match.test(msg)) return { error, hint };
  }
  return {
    error: `unknown${e?.code ? `_${e.code}` : ''}`,
    hint: 'See the service logs for details.',
    detail: safeDetail(msg),
  };
}

async function timed<T>(fn: () => Promise<T>, ms = 12_000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), ms),
    ),
  ]);
}

@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Db,
    private readonly migrations: MigrationService,
  ) {}

  /** Liveness only (used by the host's health check): the process is up. */
  @Get('live')
  live() {
    return { success: true, status: 'live', time: new Date().toISOString() };
  }

  /** Readiness + diagnostics. 200 when everything required works, 503 otherwise. */
  @Get()
  async health(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, Check> = {};
    // `npm run dev:local`: no Supabase at all; sign-in and uploads are simulated locally.
    const localDev = env('NODE_ENV') !== 'production' && env('AUTH_DEV_LOGIN') === 'true';
    const missing = REQUIRED.filter((k) => !env(k) && !(localDev && k !== 'DATABASE_URL'));
    checks.config = { ok: missing.length === 0, missing };

    // Database
    const started = Date.now();
    try {
      await timed(() => this.db.one('select 1 as ok'));
      checks.database = { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      checks.database = { ok: false, ...explainDbError(error) };
    }

    // Schema + migrations (only meaningful once the database answers)
    if (checks.database.ok) {
      try {
        const rows = await this.db.many<{ name: string; present: boolean }>(
          'select t as name, to_regclass($1 || t) is not null as present from unnest($2::text[]) t',
          ['public.', TABLES],
        );
        const missingTables = rows.filter((r) => !r.present).map((r) => r.name);
        checks.schema = {
          ok: missingTables.length === 0,
          missingTables,
          ...(missingTables.length
            ? {
                hint: 'Apply the migrations in supabase/migrations (the server does this on start when migration history exists).',
              }
            : {}),
        };
      } catch (error) {
        checks.schema = { ok: false, ...explainDbError(error) };
      }
    } else {
      checks.schema = { ok: false, error: 'database_unavailable' };
    }
    const m = this.migrations.status;
    checks.migrations = {
      ok: m.state === 'ok' || (m.state === 'skipped' && checks.schema.ok === true),
      ...m,
    };

    // Supabase Auth (sign-in)
    const sbUrl = env('SUPABASE_URL')?.replace(/\/$/, '');
    const sbKey = env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY');
    if (localDev) {
      checks.auth = { ok: true, mode: 'local-dev-login' };
    } else if (!sbUrl || !sbKey) {
      checks.auth = {
        ok: false,
        error: 'not_configured',
        hint: 'Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.',
      };
    } else {
      try {
        const r = await timed(() =>
          fetch(`${sbUrl}/auth/v1/settings`, { headers: { apikey: sbKey } }),
        );
        if (r.ok) {
          const s = (await r.json()) as { external?: Record<string, boolean> };
          checks.auth = {
            ok: true,
            password: Boolean(s.external?.email),
            google: Boolean(s.external?.google),
            discord: Boolean(s.external?.discord),
            ...(stagingAdmin() && { stagingAdmin: true }),
          };
        } else {
          checks.auth = {
            ok: false,
            error: r.status === 401 ? 'key_rejected' : `http_${r.status}`,
            hint: 'Check SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY belong to the same project.',
          };
        }
      } catch {
        checks.auth = {
          ok: false,
          error: 'unreachable',
          hint: 'SUPABASE_URL could not be reached.',
        };
      }
    }

    // Storage (admin photo uploads)
    const service = env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
    if (localDev && (!sbUrl || !service)) {
      checks.storage = { ok: true, mode: 'local-disk' };
    } else if (!sbUrl || !service) {
      checks.storage = {
        ok: false,
        error: 'not_configured',
        hint: 'Set SUPABASE_SERVICE_ROLE_KEY for photo uploads.',
      };
    } else {
      try {
        const r = await timed(() =>
          fetch(`${sbUrl}/storage/v1/bucket/product-images`, {
            headers: { Authorization: `Bearer ${service}`, apikey: service },
          }),
        );
        checks.storage = r.ok
          ? { ok: true }
          : {
              ok: false,
              error:
                r.status === 404 || r.status === 400
                  ? 'bucket_missing'
                  : r.status === 401 || r.status === 403
                    ? 'key_rejected'
                    : `http_${r.status}`,
              hint:
                r.status === 404 || r.status === 400
                  ? 'The product-images bucket is created by migration 20260929120000.'
                  : 'Check SUPABASE_SERVICE_ROLE_KEY.',
            };
      } catch {
        checks.storage = { ok: false, error: 'unreachable' };
      }
    }

    // Optional integrations: configured or not (never fails readiness).
    const integrations = Object.fromEntries(
      Object.entries(OPTIONAL).map(([name, keys]) => [
        name,
        keys.every((k) => env(k)) ? 'configured' : 'not_configured',
      ]),
    );

    const ok = ['config', 'database', 'schema', 'auth'].every((k) => checks[k].ok);
    res.status(ok ? 200 : 503);
    return {
      success: ok,
      status: ok ? 'ok' : 'degraded',
      checks,
      integrations,
      environment: env('APP_ENV') ?? 'production',
      version: env('RENDER_GIT_COMMIT')?.slice(0, 7) ?? null,
      time: new Date().toISOString(),
    };
  }
}
