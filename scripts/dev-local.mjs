// Local development without Docker or a Supabase account:
//   npm run dev:local
// Starts an in-process Postgres (PGlite) with the real Supabase migrations, seeds a sample
// catalog + category tree + a few orders, then runs the API against it with dev sign-in.
//
//   API:      http://localhost:8080
//   Sign in:  owner@spinhobby.test / spinhobby   (owner)
//             staff@spinhobby.test / spinhobby   (staff)
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedSample } from './seed-data.mjs';

const DB_PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const root = join(import.meta.dirname, '..');
const migrations = join(root, 'supabase', 'migrations');

const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;
`);
for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(migrations, file), 'utf8'));

// ---- seed: accounts
for (const [email, role] of [['owner@spinhobby.test', 'owner'], ['staff@spinhobby.test', 'staff']]) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  await db.query('update public.profiles set role = $2 where id = $1', [id, role]);
}

// ---- seed: catalog, categories and orders
const seeded = await seedSample(db);

const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
await server.start();
console.log(`\n  Local Postgres (PGlite) on :${DB_PORT} — ${seeded.products} products, ${seeded.categories} categories`);
console.log('  Sign in: owner@spinhobby.test / spinhobby  (or staff@spinhobby.test)\n');

const api = spawn('npx', ['nest', 'start', '--watch'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: process.env.PORT ?? '8080',
    DATABASE_URL: `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`,
    DATABASE_SSL: 'false',
    DATABASE_POOL_SIZE: '1',
    SUPABASE_URL: '',
    SUPABASE_JWT_SECRET: 'local-dev-secret-local-dev-secret-0000',
    AUTH_DEV_LOGIN: 'true',
    AUTH_DEV_USERS: 'owner@spinhobby.test,staff@spinhobby.test',
    AUTH_DEV_PASSWORD: 'spinhobby',
    ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173',
  },
});
const stop = async () => { api.kill('SIGTERM'); await server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => { if (code) process.exit(code); });
