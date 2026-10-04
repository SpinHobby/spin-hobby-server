import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../database/db.service.js';
import type { MigrationService } from '../../database/migrations/migration.service.js';
import { HealthService } from './health.service.js';

const REQUIRED = [
  'DATABASE_URL',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const saved = { ...process.env };

/** A database that answers every query, or throws `failure` for all of them. */
function fakeDb(failure?: Error & { code?: string }) {
  const answer = async () => {
    if (failure) throw failure;
    return [];
  };
  return {
    one: async () => {
      if (failure) throw failure;
      return { ok: 1 };
    },
    many: async () => (failure ? answer() : TABLES_PRESENT),
  } as unknown as Db;
}
const TABLES_PRESENT = [
  'profiles',
  'store_settings',
  'catalog_products',
  'hero_slides',
  'ai_usage_log',
  'store_categories',
].map((name) => ({ name, present: true }));
const migrations = { status: { state: 'ok' } } as unknown as MigrationService;

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_DEV_LOGIN = 'true'; // local dev mode: no Supabase calls from the checks
  for (const key of REQUIRED) delete process.env[key];
  process.env.DATABASE_URL = 'postgres://x';
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

describe('HealthService', () => {
  it('is ready when config, database, schema and auth are fine', async () => {
    const { ok, body } = await new HealthService(fakeDb(), migrations).report();
    expect(ok).toBe(true);
    expect(body).toMatchObject({ success: true, status: 'ok' });
    expect(body.checks.database).toMatchObject({ ok: true });
    expect(body.checks.auth).toEqual({ ok: true, mode: 'local-dev-login' });
    expect(body.checks.storage).toEqual({ ok: true, mode: 'local-disk' });
  });

  it('is degraded, with a plain-language reason, when the database is down', async () => {
    const down = Object.assign(new Error('connect ENOTFOUND db.example.com'), {
      code: 'ENOTFOUND',
    });
    const { ok, body } = await new HealthService(fakeDb(down), migrations).report();
    expect(ok).toBe(false);
    expect(body.status).toBe('degraded');
    expect(body.checks.database).toMatchObject({ ok: false, error: 'host_not_found' });
    expect(body.checks.schema).toEqual({ ok: false, error: 'database_unavailable' });
  });

  it('lists the missing required settings', async () => {
    delete process.env.DATABASE_URL;
    const { ok, body } = await new HealthService(fakeDb(), migrations).report();
    expect(ok).toBe(false);
    expect(body.checks.config).toEqual({ ok: false, missing: ['DATABASE_URL'] });
  });

  it('reports a missing table and how to fix it', async () => {
    const db = {
      one: async () => ({ ok: 1 }),
      many: async () =>
        TABLES_PRESENT.map((t) => (t.name === 'store_categories' ? { ...t, present: false } : t)),
    } as unknown as Db;
    const { ok, body } = await new HealthService(db, migrations).report();
    expect(ok).toBe(false);
    expect(body.checks.schema).toMatchObject({ ok: false, missingTables: ['store_categories'] });
    expect(body.checks.schema.hint).toContain('supabase/migrations');
  });

  it('reports which optional integrations are configured, without failing readiness', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 't';
    process.env.SQUARE_APPLICATION_ID = 'a';
    process.env.SQUARE_LOCATION_ID = 'l';
    process.env.RESEND_API_KEY = 'k'; // FROM_EMAIL missing: email is not usable
    const { ok, body } = await new HealthService(fakeDb(), migrations).report();
    expect(ok).toBe(true);
    expect(body.integrations).toEqual({
      paypal: 'not_configured',
      square: 'configured',
      email: 'not_configured',
      cashierAi: 'not_configured',
    });
  });

  it('never includes secrets in its output', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret-service-key';
    process.env.DATABASE_URL = 'postgres://user:hunter2@host/db';
    const text = JSON.stringify((await new HealthService(fakeDb(), migrations).report()).body);
    expect(text).not.toContain('super-secret-service-key');
    expect(text).not.toContain('hunter2');
  });
});
