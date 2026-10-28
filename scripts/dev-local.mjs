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
// the API is up, so the Square items show next to the samples. With SQUARE_ENVIRONMENT=sandbox and SQUARE_APPLICATION_ID
// the local checkout also uses Square sandbox payments. The database lives in memory, so this repeats on every start.
// Set DEV_SYNC_SQUARE=false or DEV_SQUARE_PAYMENTS=false to skip either part.
//
// Your own database instead (data kept between runs): set DEV_DATABASE_URL in .env to a free Supabase or Neon project made for
// development. dev:local applies the migrations it has not had yet and loads the sample shop the first time
// (`npm run dev:local -- --reset` reloads the samples). See scripts/own-database.mjs and docs/INTERNS.md.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join } from 'node:path';

const DB_PORT = Number(process.env.DEV_DB_PORT ?? 54329);
/** The Shop playlist a fresh local shop starts with (a YouTube playlist id; change it in Admin > Settings). */
const SAMPLE_PLAYLIST = 'PL_2lkrucjEN8iaGjOLqy88cFsXFUpE6ey';
const root = join(import.meta.dirname, '..');
const migrations = join(root, 'supabase', 'migrations');

const fileEnv = {};
if (existsSync(join(root, '.env'))) {
  try {
    Object.assign(fileEnv, parseEnv(readFileSync(join(root, '.env'), 'utf8')));
  } catch {
    /* unreadable .env: carry on without it */
  }
}
const setting = (name) => process.env[name] || fileEnv[name] || '';
const ownDatabase = setting('DEV_DATABASE_URL');
const imageBase = `http://localhost:${process.env.PORT ?? '8080'}`;
/** Extra editions of the sample products, so lists (Admin > Products at 500 per page) run past a page. */
const MORE_PRODUCTS = 520;

// The sample catalog is part of the API (src/modules/sample), so build once and load it from dist.
execSync('npx nest build', { cwd: root, stdio: 'inherit' });
const sample = await import(new URL('../dist/modules/sample/seed.js', import.meta.url));
const { seedSample } = sample;

let db = null;
let server = null;
let seeded = null;
if (ownDatabase) {
  const { prepareOwnDatabase } = await import('./own-database.mjs');
  try {
    await prepareOwnDatabase(ownDatabase, {
      root,
      imageBase,
      reset: process.argv.includes('--reset'),
      moreProducts: MORE_PRODUCTS,
      ...sample,
    });
  } catch (error) {
    console.error(`\n  Could not use your database (DEV_DATABASE_URL): ${error.message}\n`);
    process.exit(1);
  }
} else {
  db = await PGlite.create({ extensions: { pgcrypto } });
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
  seeded = await seedSample(db, imageBase, { more: MORE_PRODUCTS });

  // ---- seed: the storefront's Shop playlist (Admin > Settings), so its player shows from the first start
  await db.query('update public.store_settings set music_playlist_id = $1 where id = true', [
    SAMPLE_PLAYLIST,
  ]);
}

// ---- a local copy never touches the real shop or real money
// Keys for the live shop (production Square, live PayPal, production eBay) are blanked for this run, whatever .env says: a local "add product" or
// stock change must never reach the real catalog. Sandbox keys work as usual. A blank value also wins over .env (the API never re-reads it).
const blanked = {};
const blank = (names, why) => {
  const present = names.filter((n) => setting(n));
  if (!present.length) return;
  for (const n of names) blanked[n] = '';
  console.log(
    `\n  Left out of this local run: ${present.join(', ')} (${why}). Use sandbox keys locally.`,
  );
};
if ((setting('SQUARE_ENV') || setting('SQUARE_ENVIRONMENT')) !== 'sandbox')
  blank(
    [
      'SQUARE_ACCESS_TOKEN',
      'SQUARE_APPLICATION_ID',
      'SQUARE_LOCATION_ID',
      'SQUARE_WEBHOOK_SIGNATURE_KEY',
    ],
    'Square keys that are not sandbox ones',
  );
if (setting('PAYPAL_ENV') === 'live')
  blank(['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'], 'live PayPal keys');
if (setting('EBAY_ENVIRONMENT') !== 'sandbox')
  blank(
    ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_RU_NAME'],
    'eBay keys that are not sandbox ones',
  );
if (db) {
  // the paid AI tool (if its key is set) stops for the month at $5 here, not the shop's $30 (own databases get the same in own-database.mjs)
  await db.query(
    "insert into public.ai_budgets (tool, warn_threshold_usd, stop_threshold_usd) values ('anthropic_cashier', 2, 5) on conflict (tool) do update set warn_threshold_usd = 2, stop_threshold_usd = 5",
  );
  server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
  await server.start();
  console.log(
    `\n  Local Postgres (PGlite) on :${DB_PORT} — ${seeded.products} products, ${seeded.categories} categories (in memory: fresh on every start)`,
  );
}
const ownHost = ownDatabase ? new URL(ownDatabase).hostname : '';
const ownIsLocal = ownHost === 'localhost' || ownHost === '127.0.0.1';
console.log('  Sign in: owner@spinhobby.test / spinhobby  (or staff@spinhobby.test)\n');
const squareReady =
  !('SQUARE_ACCESS_TOKEN' in blanked) &&
  setting('SQUARE_ACCESS_TOKEN') &&
  setting('SQUARE_APPLICATION_ID') &&
  setting('SQUARE_LOCATION_ID');
const paypalReady =
  !('PAYPAL_CLIENT_ID' in blanked) &&
  setting('PAYPAL_CLIENT_ID') &&
  setting('PAYPAL_CLIENT_SECRET');
if (!squareReady && !paypalReady)
  console.log('  Checkout: test payments (no payment keys set; no money is involved)\n');

// Run the Nest CLI with this same Node binary rather than `npx`: on Windows `npx` is a .cmd shim that
// spawn() can't launch without a shell, and a shell wrapper would leave the API running after Ctrl+C.
const nestCli = join(root, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js');
const api = spawn(process.execPath, [nestCli, 'start', '--watch'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: process.env.PORT ?? '8080',
    ...(ownDatabase
      ? { DATABASE_URL: ownDatabase, DATABASE_SSL: ownIsLocal ? 'false' : 'true' }
      : {
          DATABASE_URL: `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`,
          DATABASE_SSL: 'false',
          DATABASE_POOL_SIZE: '1',
        }),
    SUPABASE_URL: '',
    SUPABASE_JWT_SECRET: 'local-dev-secret-local-dev-secret-0000',
    AUTH_DEV_LOGIN: 'true',
    AUTH_DEV_USERS: 'owner@spinhobby.test,staff@spinhobby.test',
    AUTH_DEV_PASSWORD: 'spinhobby',
    ALLOWED_ORIGINS: 'http://localhost:5173,http://localhost:4173',
    // checkout completes with a test payment (no money) when no payment keys are set
    DEV_TEST_PAYMENTS: 'true',
    ...blanked,
  },
});
const stop = async () => {
  api.kill('SIGTERM');
  await server?.stop();
  await db?.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
api.on('exit', (code) => {
  if (code) process.exit(code);
});

// ---- optional: connect Square (sandbox) once the API answers
// With Square credentials in .env the local shop pulls the Square catalog in and takes card payments through Square's
// sandbox (test cards only; no real money moves). Switch either part off with DEV_SYNC_SQUARE=false / DEV_SQUARE_PAYMENTS=false.
async function connectSquare() {
  if (existsSync(join(root, '.env'))) {
    try {
      process.loadEnvFile(join(root, '.env'));
    } catch {
      /* unreadable .env: carry on without it */
    }
  }
  if (
    'SQUARE_ACCESS_TOKEN' in blanked ||
    !process.env.SQUARE_ACCESS_TOKEN ||
    !process.env.SQUARE_LOCATION_ID
  )
    return;
  const sandbox = (process.env.SQUARE_ENV || process.env.SQUARE_ENVIRONMENT) === 'sandbox';
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
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

    // Card payments through Square: only ever for the sandbox, so a production token can never take a local payment.
    if (
      process.env.DEV_SQUARE_PAYMENTS !== 'false' &&
      sandbox &&
      process.env.SQUARE_APPLICATION_ID
    ) {
      const res = await fetch(`${base}/admin/settings`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ payment_provider: 'square' }),
      });
      console.log(
        res.ok
          ? '\n  Checkout: Square sandbox payments (use Square test cards, e.g. 4111 1111 1111 1111)\n'
          : `\n  Square payments not switched on: ${(await res.json()).error ?? res.status}\n`,
      );
    } else if (!sandbox) {
      console.log(
        '\n  Square payments left off: set SQUARE_ENVIRONMENT=sandbox in .env to use Square sandbox checkout locally.\n',
      );
    }

    if (process.env.DEV_SYNC_SQUARE === 'false') return;
    const res = await fetch(`${base}/admin/square/sync`, { method: 'POST', headers });
    const body = await res.json();
    if (res.ok)
      console.log(
        `\n  Square sync: ${body.sync.products} products, ${body.sync.inventory} stock counts\n`,
      );
    else console.log(`\n  Square sync skipped: ${body.error ?? res.status}\n`);
  } catch (e) {
    console.log(`\n  Square connection skipped: ${e.message}\n`);
  }
}

/** Whether the API answers, trying every second for up to `seconds`. */
async function apiAnswers(base, seconds) {
  for (let i = 0; i < seconds; i += 1) {
    if (
      await fetch(`${base}/health/live`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ---- say clearly when it is ready (the API's own start-up lines are many, and the window then just stays open, which looks stuck)
async function announceReady() {
  const port = process.env.PORT ?? '8080';
  const base = `http://localhost:${port}`;
  if (!(await apiAnswers(base, 180))) {
    console.log(
      `\n  Still starting after 3 minutes. A first start on a slow computer can take longer. If you see an error above, that is\n` +
        `  what to fix (or send it to us): for example EADDRINUSE means port ${port} or ${DB_PORT} is already used by an earlier run.\n`,
    );
    if (!(await apiAnswers(base, 600))) return;
  }
  await connectSquare();
  const line = '  ' + '-'.repeat(72);
  console.log(
    [
      '',
      line,
      '  Spin Hobby is running.',
      `    API docs: ${base}/docs`,
      '    Website:  in the spin-hobby folder run `npm run dev`, then open http://localhost:3000',
      '    Sign in:  owner@spinhobby.test / spinhobby  (or staff@spinhobby.test)',
      '  Leave this window open: the server runs here. Ctrl+C stops it.',
      line,
      '',
    ].join('\n'),
  );
}
announceReady();
