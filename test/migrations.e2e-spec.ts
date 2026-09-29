import { mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Db } from '../src/db/db.service.js';
import { MigrationService } from '../src/migrations/migration.service.js';
import { createDatabase } from './harness.js';

const SOURCE = join(import.meta.dirname, '..', 'supabase', 'migrations');
const FILES = readdirSync(SOURCE).filter((f) => f.endsWith('.sql')).sort();

/** A database that looks like production: only the first N migrations applied and recorded by the Supabase CLI. */
async function productionLike(appliedCount: number) {
  const { pglite, driver } = await createDatabase({ migrations: FILES.slice(0, appliedCount) });
  await pglite.exec(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  for (const f of FILES.slice(0, appliedCount)) {
    await pglite.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [f.slice(0, 14), f.slice(15, -4)]);
  }
  return { pglite, service: new MigrationService(new Db(driver)) };
}

describe('migrations on start', () => {
  it('applies only migrations newer than the recorded history, once', async () => {
    process.env.MIGRATIONS_DIR = SOURCE;
    const { pglite, service } = await productionLike(2);
    const first = await service.run();
    expect(first.state).toBe('ok');
    expect(first.applied).toEqual(FILES.slice(2));
    const tables = await pglite.query<{ t: string | null }>("select to_regclass('public.store_categories')::text as t");
    expect(tables.rows[0].t).toBe('store_categories');
    const bucket = await pglite.query("select public from storage.buckets where id = 'product-images'");
    expect(bucket.rows).toEqual([{ public: true }]);
    const history = await pglite.query<{ version: string; name: string }>('select version, name from supabase_migrations.schema_migrations order by version');
    expect(history.rows.map((r) => r.version)).toEqual(FILES.map((f) => f.slice(0, 14)));
    expect(history.rows.at(-1)!.name).toBe('store_categories');

    const again = await service.run();
    expect(again).toMatchObject({ state: 'ok', applied: [], pending: [] });
    await pglite.close();
  });

  it('stops at a failing migration, keeps earlier ones, and reports it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    for (const f of FILES) copyFileSync(join(SOURCE, f), join(dir, f));
    writeFileSync(join(dir, '20991231000000_broken.sql'), 'create table public.oops (id int); select * from public.does_not_exist;');
    writeFileSync(join(dir, '20991231000001_after.sql'), 'create table public.after_broken (id int);');
    process.env.MIGRATIONS_DIR = dir;
    const { pglite, service } = await productionLike(FILES.length);
    const res = await service.run();
    expect(res.state).toBe('failed');
    expect(res.message).toMatch(/^20991231000000_broken\.sql: .*does_not_exist/);
    expect(res.pending).toEqual(['20991231000000_broken.sql', '20991231000001_after.sql']);
    const oops = await pglite.query<{ t: string | null }>("select to_regclass('public.oops')::text as t");
    expect(oops.rows[0].t).toBeNull(); // the failed file was rolled back entirely
    process.env.MIGRATIONS_DIR = SOURCE;
    await pglite.close();
  });

  it('does nothing without Supabase migration history', async () => {
    process.env.MIGRATIONS_DIR = SOURCE;
    const { pglite, driver } = await createDatabase({ migrations: FILES.slice(0, 2) });
    const res = await new MigrationService(new Db(driver)).run();
    expect(res.state).toBe('skipped');
    expect((await pglite.query<{ t: string | null }>("select to_regclass('public.store_categories')::text as t")).rows[0].t).toBeNull();
    await pglite.close();
  });
});
