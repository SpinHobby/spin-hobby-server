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

// ---- seed: category tree
const tree = [
  ['Figures', ['Scale Figures', 'Prize Figures', 'Chibi Figures', 'Model Kits']],
  ['Plushies', []],
  ['Goods', ['Badges & Acrylics', 'Keychains', 'Blind Boxes', 'Apparel & Posters']],
  ['Trading Cards', []],
  ['Books & Media', ['Books & Doujin', 'Video & Music']],
];
const categoryIds = new Map();
for (const [i, [parent, children]] of tree.entries()) {
  const { rows } = await db.query('insert into public.store_categories (name, sort_order) values ($1, $2) returning id', [parent, i]);
  categoryIds.set(parent, rows[0].id);
  for (const [j, child] of children.entries()) {
    const r = await db.query('insert into public.store_categories (parent_id, name, sort_order) values ($1, $2, $3) returning id', [rows[0].id, child, j]);
    categoryIds.set(child, r.rows[0].id);
  }
}

// ---- seed: products  [name, category, dollars, availability, stock, release, orderByDays, discount%, rank, featured]
const products = [
  ['Character Name 1/7 Scale Figure', 'Scale Figures', 229, 'preorder', null, '2027-03-01', 22, 0, 1, true],
  ['Character Name 1/6 Scale Figure — Bunny Ver.', 'Scale Figures', 289, 'preorder', null, '2027-05-01', 37, 0, 4, false],
  ['Character Name 1/7 Scale Figure — Summer', 'Scale Figures', 199, 'auto', 3, null, null, 15, 9, false],
  ['Character Name Prize Figure', 'Prize Figures', 39, 'auto', 12, null, null, 0, 2, true],
  ['Character Name Prize Figure — Noodle Stopper', 'Prize Figures', 34, 'auto', 20, null, null, 0, 11, false],
  ['Character Name Chibi Figure', 'Chibi Figures', 64, 'auto', 2, null, null, 0, 3, true],
  ['Plastic Model Kit — HG 1/144', 'Model Kits', 58, 'auto', 5, null, null, 10, 14, false],
  ['Mascot Plushie — 20cm', 'Plushies', 32, 'auto', 8, null, null, 0, 5, false],
  ['Big Plushie Cushion — 40cm', 'Plushies', 55, 'preorder', null, '2026-12-01', 12, 0, 8, false],
  ['Acrylic Stand — Key Art Ver.', 'Badges & Acrylics', 24, 'auto', null, null, null, 0, 13, false],
  ['Can Badge Set (6 pcs)', 'Badges & Acrylics', 18, 'auto', 0, null, null, 0, 6, false],
  ['Acrylic Keychain — Chibi Ver.', 'Keychains', 14, 'auto', 4, null, null, 0, 18, false],
  ['Trading Card Booster Box', 'Trading Cards', 89, 'auto', 3, null, null, 0, 10, false],
  ['Blind Box — Vol. 1 (random)', 'Blind Boxes', 14, 'auto', 40, null, null, 0, 15, false],
  ['Doujin Illustration Book', 'Books & Doujin', 28, 'auto', 6, null, null, 0, 21, false],
  ['Original Soundtrack CD', 'Video & Music', 38, 'auto', 7, null, null, 20, 23, false],
  ['B2 Wall Tapestry', 'Apparel & Posters', 35, 'preorder', null, '2026-12-01', 27, 0, 24, false],
];
const variations = [];
for (const [i, [name, category, dollars, availability, stock, release, orderByDays, discount, rank, featured]] of products.entries()) {
  const id = `manual-dev-${i + 1}`;
  const variation = `${id}-v`;
  const price = discount ? Math.round(dollars * (100 - discount)) : dollars * 100;
  await db.query("insert into public.catalog_products (square_item_id, name, category, source, created_at) values ($1, $2, $3, 'manual', now() - ($4 || ' days')::interval)", [id, name, category, products.length - i]);
  await db.query("insert into public.catalog_variations (square_variation_id, square_item_id, name, price_cents) values ($1, $2, 'Regular', $3)", [variation, id, price]);
  await db.query('update public.catalog_products set default_variation_id = $2 where square_item_id = $1', [id, variation]);
  await db.query('insert into public.inventory_snapshots (square_variation_id, quantity) values ($1, $2)', [variation, stock]);
  await db.query(
    `insert into public.product_metadata (square_item_id, availability, release_month, order_by_date, series, compare_at_cents, is_featured, category_id, jan_code)
     values ($1, $2, $3, case when $4::int is null then null else now() + ($4 || ' days')::interval end, $5, $6, $7, $8, $9)`,
    [id, availability, release, orderByDays, i % 5 === 3 ? 'Circle Name' : 'Series Title', discount ? dollars * 100 : null, featured, categoryIds.get(category), `458000${String(1000000 + i * 7919).slice(0, 7)}`],
  );
  await db.query('insert into public.sales_stats (square_item_id, rank) values ($1, $2)', [id, rank]);
  variations.push({ id, variation, name, price, preorder: availability === 'preorder' });
}

// ---- seed: a few orders for the admin dashboard
const people = [['A.', 'Nguyen', 'Calgary', 'AB'], ['M.', 'Tremblay', 'Edmonton', 'AB'], ['K.', 'Sato', 'Vancouver', 'BC'], ['J.', 'Singh', 'Toronto', 'ON']];
for (const [i, [first, last, city, province]] of people.entries()) {
  const item = variations[(i * 3 + 3) % variations.length];
  const status = item.preorder ? 'preorder_reserved' : i === 3 ? 'shipped' : 'paid';
  const address = JSON.stringify({ firstName: first, lastName: last, address1: `${100 + i * 12} Main St`, city, province, postalCode: 'T5J 0N3', country: 'CA' });
  const email = `${last.toLowerCase()}@example.com`;
  const shipping = item.price >= 7500 ? 0 : 899;
  const { rows } = await db.query(
    `insert into public.orders (status, provider, provider_payment_id, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_method, billing_email, billing_address, shipping_address, created_at)
     values ($1, 'paypal', $2, $3, $4, 0, $5, 'standard', $6, $7, $7, now() - ($8 || ' hours')::interval) returning id`,
    [status, `DEV-CAP-${i}`, item.price, shipping, item.price + shipping, email, address, i * 20 + 2],
  );
  await db.query('insert into public.order_items (order_id, square_item_id, square_variation_id, name, unit_price_cents, quantity, is_preorder) values ($1, $2, $3, $4, $5, 1, $6)', [rows[0].id, item.id, item.variation, item.name, item.price, item.preorder]);
}

const server = new PGLiteSocketServer({ db, port: DB_PORT, host: '127.0.0.1' });
await server.start();
console.log(`\n  Local Postgres (PGlite) on :${DB_PORT} — ${products.length} products, ${categoryIds.size} categories`);
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
