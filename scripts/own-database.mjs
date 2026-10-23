// Your own development database (a free Supabase or Neon project) for `npm run dev:local`, instead of the in-memory one.
// Set DEV_DATABASE_URL in .env; dev:local then calls prepareOwnDatabase() before starting the API. It
//   - refuses the shop's production database, and any address that is not a database you made for development;
//   - adds the few Supabase pieces the migrations expect when the database is plain Postgres (Neon): auth.users, storage tables, roles;
//   - applies every migration in supabase/migrations that the database has not had yet, recording each in
//     supabase_migrations.schema_migrations (the table the API's own migration runner reads on every later start);
//   - loads the sample shop and the two test accounts the first time, when the catalog is empty (or again with --reset).
// Data stays between runs. See docs/INTERNS.md, "Your own database".
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const PRODUCTION_REF = 'zmlltsytckexrmybvnof';
const LOCK_KEY = 72_4_2026; // the API's migration runner uses the same one: they never run at the same time

/** Why this address must not be used, or null when it is fine. */
export function refuseReason(url) {
  if (url.includes(PRODUCTION_REF)) return 'That is the shop’s PRODUCTION database.';
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'DEV_DATABASE_URL is not a connection address (it should start with postgresql://).';
  }
  if (/onrender\.com$/.test(host))
    return 'That looks like a Render-hosted database, not one you made for development.';
  return null;
}

const quiet = (url) => url.replace(/\/\/([^:@/]+)(:[^@]*)?@/, '//$1:***@');

export async function prepareOwnDatabase(
  url,
  { root, imageBase, reset = false, seedSample, clearSample, countProducts },
) {
  const reason = refuseReason(url);
  if (reason)
    throw new Error(
      `${reason} Refusing to use it. Make your own free project (docs/INTERNS.md, "Your own database").`,
    );
  const host = new URL(url).hostname;
  const local = host === 'localhost' || host === '127.0.0.1';
  const db = new pg.Client({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await db.connect();
  try {
    await db.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    const exists = async (name) =>
      (await db.query('select to_regclass($1) is not null as ok', [name])).rows[0].ok;

    // ---- plain Postgres (Neon): the Supabase pieces the migrations refer to. A Supabase project has them already.
    if (!(await exists('auth.users'))) {
      await db.query(`
        create schema if not exists auth;
        create table if not exists auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
        create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      `);
      console.log(
        '  Your database is plain Postgres: added the small auth stand-in the migrations expect.',
      );
    }
    if (!(await exists('storage.buckets')))
      await db.query(`
        create schema if not exists storage;
        create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
        create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
      `);
    for (const role of ['anon', 'authenticated', 'service_role'])
      await db.query(`do $$ begin create role ${role}; exception when others then null; end $$`);

    // ---- migrations not applied yet, oldest first, each in its own transaction
    await db.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);
    `);
    const done = new Set(
      (await db.query('select version from supabase_migrations.schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );
    const dir = join(root, 'supabase', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => /^\d{14}_.+\.sql$/.test(f))
      .sort();
    let applied = 0;
    for (const file of files) {
      const version = file.slice(0, 14);
      if (done.has(version)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      try {
        await db.query('begin');
        await db.query(sql);
        await db.query(
          'insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
          [version, file.slice(15, -4)],
        );
        await db.query('commit');
        applied++;
      } catch (error) {
        await db.query('rollback').catch(() => {});
        throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
      }
    }

    // ---- the sample shop and test accounts: once, while the catalog is empty (or again with --reset)
    if (reset) await clearSample(db);
    let seeded = null;
    if (reset || (await countProducts(db)) === 0) {
      for (const [email, role] of [
        ['owner@spinhobby.test', 'owner'],
        ['staff@spinhobby.test', 'staff'],
      ]) {
        const found = await db.query('select id from auth.users where email = $1', [email]);
        const id =
          found.rows[0]?.id ??
          (
            await db.query(
              'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id',
              [email],
            )
          ).rows[0].id;
        await db.query('update public.profiles set role = $2 where id = $1', [id, role]);
      }
      seeded = await seedSample(db, imageBase);
    }
    await db.query(
      "insert into public.ai_budgets (tool, warn_threshold_usd, stop_threshold_usd) values ('anthropic_cashier', 2, 5) on conflict (tool) do update set warn_threshold_usd = 2, stop_threshold_usd = 5",
    );
    const products = await countProducts(db);
    console.log(
      `\n  Your database (${quiet(url).replace(/^postgres(ql)?:\/\/[^@]*@/, '')}): ${applied ? `applied ${applied} migration${applied === 1 ? '' : 's'}; ` : 'schema up to date; '}` +
        (seeded
          ? `loaded the sample shop (${seeded.products} products)`
          : `${products} products kept from last time (--reset reloads the samples)`),
    );
    return { applied, products };
  } finally {
    await db.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await db.end();
  }
}
