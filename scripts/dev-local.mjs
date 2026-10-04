// Local development without Docker or a Supabase account:
//   npm run dev:local
// Starts an in-process Postgres (PGlite) with the real Supabase migrations, seeds a sample
// catalog + category tree + a few orders, then runs the API against it with dev sign-in.
//
//   API:      http://localhost:8080
//   Sign in:  owner@spinhobby.test / spinhobby   (owner)
//             staff@spinhobby.test / spinhobby   (staff)
//
// If SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID are set (shell or .env), the catalog is also synced from Square once
// the API is up, so the Square items show next to the samples. The database lives in memory, so this repeats on every
// start. Set DEV_SYNC_SQUARE=false to skip it.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DB_PORT = Number(process.env.DEV_DB_PORT ?? 54329);
const root = join(import.meta.dirname, '..');
const migrations = join(root, 'supabase', 'migrations');

// The sample catalog is part of the API (src/sample), so build once and load it from dist.
execSync('npx nest build', { cwd: root, stdio: 'inherit' });
const { seedSample } = await import(new URL('../dist/sample/seed.js', import.meta.url));

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
for (const file of readdirSync(migrations)
  .filter((f) => f.endsWith('.sql'))
  .sort())
  await db.exec(readFileSync(join(migrations, file), 'utf8'));

// ---- seed: accounts
for (const [email, role] of [
  ['owner@spinhobby.test', 'owner'],
  ['staff@spinhobby.test', 'staff'],
]) {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  await db.query('update public.profiles set role = $2 where id = $1', [id, role]);
}

// ---- seed: catalog, categories and orders
const seeded = await seedSample(db, `http://localhost:${process.env.PORT ?? '8080'}`);

const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
await server.start();
console.log(
  `\n  Local Postgres (PGlite) on :${DB_PORT} — ${seeded.products} products, ${seeded.categories} categories`,
);
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
const stop = async () => {
  api.kill('SIGTERM');
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => {
  if (code) process.exit(code);
});

// ---- optional: pull the Square catalog in once the API answers
async function syncSquare() {
  if (process.env.DEV_SYNC_SQUARE === 'false') return;
  if (existsSync(join(root, '.env'))) {
    try {
      process.loadEnvFile(join(root, '.env'));
    } catch {
      /* unreadable .env: carry on without it */
    }
  }
  if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) return;
  const base = `http://localhost:${process.env.PORT ?? '8080'}`;
  for (let i = 0; i < 120; i += 1) {
    if (
      await fetch(`${base}/health/live`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  try {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@spinhobby.test', password: 'spinhobby' }),
    });
    const { accessToken } = await login.json();
    const res = await fetch(`${base}/admin/square/sync`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = await res.json();
    if (res.ok)
      console.log(
        `\n  Square sync: ${body.sync.products} products, ${body.sync.inventory} stock counts\n`,
      );
    else console.log(`\n  Square sync skipped: ${body.error ?? res.status}\n`);
  } catch (e) {
    console.log(`\n  Square sync skipped: ${e.message}\n`);
  }
}
syncSquare();
