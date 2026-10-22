import { PGlite, types } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module.js';
import { DB_DRIVER, type DbDriver } from '../../src/database/db.service.js';
import { configureApp } from '../../src/app.setup.js';

export const JWT_SECRET = 'test-secret-at-least-32-characters-long!!';
const MIGRATIONS = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');

// Stand-ins for the Supabase-managed schemas the migrations reference.
const SUPABASE_STUBS = `
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;
`;

export async function createDatabase(options: { migrations?: string[] } = {}) {
  // Same value shapes as the production pg driver (see db.service.ts).
  const pglite = new PGlite({
    extensions: { pgcrypto },
    parsers: {
      [types.INT8]: (v: string) => Number(v),
      [types.NUMERIC]: (v: string) => Number(v),
      [types.DATE]: (v: string) => v,
      [types.TIMESTAMPTZ]: (v: string) => new Date(v).toISOString(),
      [types.TIMESTAMP]: (v: string) => new Date(`${v}Z`).toISOString(),
    },
  });
  await pglite.exec(SUPABASE_STUBS);
  for (const file of options.migrations ??
    readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
    await pglite.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  const driver: DbDriver = {
    query: (sql, params) => pglite.query(sql, params as any[]) as any,
    script: async (sql) => {
      await pglite.exec(sql);
    },
    transaction: (fn) =>
      pglite.transaction((tx) =>
        fn({
          query: (sql, params) => tx.query(sql, params as any[]) as any,
          script: async (sql) => {
            await tx.exec(sql);
          },
        }),
      ),
    close: async () => {
      /* closed by the test */
    },
  };
  return { pglite, driver };
}

export async function createApp(driver: DbDriver) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DB_DRIVER)
    .useValue(driver)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureApp(app);
  await app.init();
  // Listen once, on 127.0.0.1 itself. Left to supertest, each request opens the server on "any address" with a random port and
  // then connects to 127.0.0.1 on that port; on macOS that port can already be taken on 127.0.0.1 by another program (an editor's
  // helper, say), which then answers instead, so a test failed now and then with a 401 that our server never sent.
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Creates a Supabase-style auth user (the trigger makes the profile) and returns a bearer token. */
export async function signUp(pglite: PGlite, email: string, role?: 'customer' | 'staff' | 'owner') {
  const id = randomUUID();
  await pglite.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  if (role) await pglite.query('update public.profiles set role = $2 where id = $1', [id, role]);
  const token = await tokenFor(id, email);
  return { id, token, auth: `Bearer ${token}` };
}

/** A Supabase-style access token for an existing auth user. */
export async function tokenFor(id: string, email: string, userMetadata?: Record<string, unknown>) {
  const jwt = new SignJWT({
    email,
    role: 'authenticated',
    ...(userMetadata && { user_metadata: userMetadata }),
  }).setProtectedHeader({ alg: 'HS256' });
  // Supabase tokens carry iss = <SUPABASE_URL>/auth/v1, which the server checks when SUPABASE_URL is set.
  if (process.env.SUPABASE_URL)
    jwt.setIssuer(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`);
  return jwt
    .setSubject(id)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

interface SeedProduct {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  stock?: number | null;
  availability?: 'auto' | 'preorder' | 'hidden';
  orderBy?: string | null;
  releaseMonth?: string | null;
  series?: string;
  jan?: string;
  compareAt?: number | null;
  maxPer?: number | null;
  featured?: boolean;
  rank?: number | null;
  image?: string;
}

export async function seedProduct(pglite: PGlite, p: SeedProduct) {
  const variation = `${p.id}_V`;
  await pglite.query(
    'insert into public.catalog_products (square_item_id, name, category) values ($1, $2, $3)',
    [p.id, p.name, p.category],
  );
  await pglite.query(
    'insert into public.catalog_variations (square_variation_id, square_item_id, name, price_cents) values ($1, $2, $3, $4)',
    [variation, p.id, 'Regular', p.priceCents],
  );
  await pglite.query(
    'update public.catalog_products set default_variation_id = $2 where square_item_id = $1',
    [p.id, variation],
  );
  if (p.stock !== undefined)
    await pglite.query(
      'insert into public.inventory_snapshots (square_variation_id, quantity) values ($1, $2)',
      [variation, p.stock],
    );
  await pglite.query(
    `insert into public.product_metadata (square_item_id, availability, order_by_date, release_month, series, jan_code, compare_at_cents, max_per_customer, is_featured)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      p.id,
      p.availability ?? 'auto',
      p.orderBy ?? null,
      p.releaseMonth ?? null,
      p.series ?? null,
      p.jan ?? null,
      p.compareAt ?? null,
      p.maxPer ?? null,
      p.featured ?? false,
    ],
  );
  if (p.rank != null)
    await pglite.query('insert into public.sales_stats (square_item_id, rank) values ($1, $2)', [
      p.id,
      p.rank,
    ]);
  if (p.image)
    await pglite.query(
      'insert into public.product_images (square_item_id, image_url) values ($1, $2)',
      [p.id, p.image],
    );
  return variation;
}

/** Routes outbound fetch() calls to handlers keyed by URL substring; anything unmatched fails the test. */
export function mockFetch(
  handlers: Record<string, (init: RequestInit | undefined, url: string) => unknown>,
) {
  const calls: { url: string; body: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const key = Object.keys(handlers).find((k) => url.includes(k));
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* form-encoded */
    }
    calls.push({ url, body });
    if (!key) throw new Error(`Unexpected outbound request in test: ${url}`);
    const result = await handlers[key](init, url);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
