import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../config/env.js';
import { Db } from '../db/db.service.js';

export interface MigrationStatus {
  state: 'ok' | 'skipped' | 'failed' | 'not-run';
  applied: string[];        // applied during this boot
  pending: string[];        // still not applied
  latest: string | null;    // newest version recorded in the database
  message?: string;
}

const LOCK_KEY = 72_4_2026; // arbitrary constant for pg_advisory_lock

/**
 * Applies supabase/migrations/*.sql that are newer than the latest version recorded in
 * supabase_migrations.schema_migrations - the same table `supabase db push` uses, so the CLI
 * and this server agree on what has run. Each file runs in its own transaction.
 *
 * Safety rules:
 * - never runs when the history table is missing or empty (unknown database state);
 * - only applies versions newer than the newest recorded one (older gaps are reported, not run);
 * - stops at the first failure and reports it via /health.
 * Disable with MIGRATE_ON_START=false.
 */
@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  status: MigrationStatus = { state: 'not-run', applied: [], pending: [], latest: null };
  private resolveReady!: (status: MigrationStatus) => void;
  /** Settles once the start-up run has finished, whatever its outcome, for work that must wait for the schema. */
  readonly ready = new Promise<MigrationStatus>((resolve) => { this.resolveReady = resolve; });

  constructor(private readonly db: Db) {}

  dir() {
    return env('MIGRATIONS_DIR') ?? join(process.cwd(), 'supabase', 'migrations');
  }

  files() {
    const dir = this.dir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => /^\d{14}_.+\.sql$/.test(f))
      .sort()
      .map((file) => ({ file, version: file.slice(0, 14), name: file.slice(15, -4) }));
  }

  async onModuleInit() {
    try {
      if (env('MIGRATE_ON_START') === 'false') { this.status = { ...this.status, state: 'skipped', message: 'MIGRATE_ON_START=false' }; return; }
      if (!env('DATABASE_URL')) { this.status = { ...this.status, state: 'skipped', message: 'DATABASE_URL is not set.' }; return; }
      await this.run();
    } catch (error) {
      this.status = { ...this.status, state: 'failed', message: (error as Error).message.split('\n')[0] };
      this.logger.error(`Migrations failed: ${this.status.message}`);
    } finally {
      this.resolveReady(this.status);
    }
  }

  async run(): Promise<MigrationStatus> {
    const files = this.files();
    const history = await this.db.one<{ exists: boolean }>("select to_regclass('supabase_migrations.schema_migrations') is not null as exists");
    if (!history?.exists) {
      this.status = { state: 'skipped', applied: [], pending: files.map((f) => f.file), latest: null, message: 'No Supabase migration history found; run `supabase db push` once.' };
      return this.status;
    }
    return this.db.transaction(async (lockTx) => {
      // One instance at a time; others wait for the lock, then find nothing pending.
      await this.db.exec('select pg_advisory_xact_lock($1)', [LOCK_KEY], lockTx);
      const rows = await this.db.many<{ version: string }>('select version from supabase_migrations.schema_migrations order by version', [], lockTx);
      const done = new Set(rows.map((r) => r.version));
      const latest = rows.at(-1)?.version ?? null;
      if (!latest) {
        this.status = { state: 'skipped', applied: [], pending: files.map((f) => f.file), latest, message: 'Migration history is empty; run `supabase db push` once.' };
        return this.status;
      }
      const columns = new Set((await this.db.many<{ column_name: string }>(
        "select column_name from information_schema.columns where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'", [], lockTx,
      )).map((c) => c.column_name));
      const gaps = files.filter((f) => !done.has(f.version) && f.version < latest).map((f) => f.file);
      const todo = files.filter((f) => f.version > latest);
      const applied: string[] = [];
      for (const m of todo) {
        const sql = readFileSync(join(this.dir(), m.file), 'utf8');
        await this.db.exec(`savepoint m_${m.version}`, [], lockTx);
        try {
          await this.db.script(sql, lockTx);
          const cols = ['version', ...(columns.has('name') ? ['name'] : []), ...(columns.has('statements') ? ['statements'] : [])];
          const vals = [m.version, ...(columns.has('name') ? [m.name] : []), ...(columns.has('statements') ? [[sql]] : [])];
          await this.db.exec(`insert into supabase_migrations.schema_migrations (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals, lockTx);
          await this.db.exec(`release savepoint m_${m.version}`, [], lockTx);
          applied.push(m.file);
          this.logger.log(`Applied migration ${m.file}`);
        } catch (error) {
          await this.db.exec(`rollback to savepoint m_${m.version}`, [], lockTx);
          this.status = {
            state: 'failed', applied, latest,
            pending: todo.map((t) => t.file).filter((f) => !applied.includes(f)),
            message: `${m.file}: ${(error as Error).message.split('\n')[0]}`,
          };
          this.logger.error(`Migration ${this.status.message}`);
          return this.status; // commits the ones that succeeded
        }
      }
      this.status = {
        state: 'ok', applied, pending: gaps, latest: applied.length ? todo.at(-1)!.version : latest,
        ...(gaps.length ? { message: `Older migrations not recorded in history (not run automatically): ${gaps.join(', ')}` } : {}),
      };
      return this.status;
    });
  }
}
