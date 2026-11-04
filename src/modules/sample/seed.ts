/**
 * Loads the sample catalog (catalog.ts) into a database: categories, products with pictures, homepage
 * banners and a month of orders. Used by the staging API on its first start, by `npm run dev:local`
 * against its in-process Postgres, and by `npm run seed:staging`.
 */
import {
  SAMPLE_CATEGORIES,
  SAMPLE_PEOPLE,
  SAMPLE_PREFIX,
  SAMPLE_PRODUCTS,
  SAMPLE_SLIDES,
  moreSampleProducts,
} from './catalog.js';

/** Anything with a pg-style query(sql, params) returning { rows }: pg.Client, PGlite, or the API's driver. */
export interface SampleDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows of an ad-hoc seed query
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
}

export async function countProducts(db: SampleDb): Promise<number> {
  const { rows } = await db.query('select count(*)::int as n from public.catalog_products');
  return rows[0].n;
}

const STATUSES = [
  'paid',
  'shipped',
  'fulfilled',
  'preorder_reserved',
  'pending',
  'cancelled',
  'refunded',
  'paid',
  'shipped',
  'paid',
  'preorder_reserved',
  'shipped',
] as const;

/** A category by name under a parent, created if missing, so re-runs and hand-made categories share one tree. */
async function category(
  db: SampleDb,
  name: string,
  parentId: string | null,
  sortOrder: number,
): Promise<string> {
  const { rows } = await db.query(
    'select id from public.store_categories where name = $1 and parent_id is not distinct from $2',
    [name, parentId],
  );
  if (rows[0]) return rows[0].id;
  const made = await db.query(
    'insert into public.store_categories (parent_id, name, sort_order) values ($1, $2, $3) returning id',
    [parentId, name, sortOrder],
  );
  return made.rows[0].id;
}

/**
 * Inserts everything. `imageBase` is where the API serves /sample-images (e.g. https://host or http://localhost:8080).
 * `more` adds that many extra editions of the products (moreSampleProducts), for long lists locally.
 */
export async function seedSample(db: SampleDb, imageBase: string, { more = 0 } = {}) {
  const base = imageBase.replace(/\/$/, '');
  const picture = (file: string) => `${base}/sample-images/${file}.svg`;

  const categoryIds = new Map<string, string>();
  for (const [i, [parent, children]] of SAMPLE_CATEGORIES.entries()) {
    const parentId = await category(db, parent, null, i);
    categoryIds.set(parent, parentId);
    for (const [j, child] of children.entries())
      categoryIds.set(child, await category(db, child, parentId, j));
  }

  // The extra editions first, so they're older than the hand-written products and those stay the newest.
  const products = [...moreSampleProducts(more), ...SAMPLE_PRODUCTS];
  for (const [i, p] of products.entries()) {
    const variation = `${p.id}-v`;
    // Spread creation over the last few weeks so "new in stock" and the admin list have an order to them.
    const hoursAgo = (products.length - i) * 5;
    await db.query(
      `insert into public.catalog_products (square_item_id, name, description, category, source, created_at, updated_at)
       values ($1, $2, $3, $4, 'manual', now() - ($5 || ' hours')::interval, now() - ($5 || ' hours')::interval)`,
      [p.id, p.name, p.description, p.category, hoursAgo],
    );
    await db.query(
      "insert into public.catalog_variations (square_variation_id, square_item_id, name, sku, price_cents) values ($1, $2, 'Regular', $3, $4)",
      [variation, p.id, p.slug.toUpperCase().slice(0, 24), p.priceCents],
    );
    await db.query(
      'update public.catalog_products set default_variation_id = $2 where square_item_id = $1',
      [p.id, variation],
    );
    await db.query(
      'insert into public.inventory_snapshots (square_variation_id, quantity) values ($1, $2)',
      [variation, p.stock],
    );
    await db.query(
      `insert into public.product_metadata (square_item_id, availability, release_month, order_by_date, series, character, manufacturer, jan_code, compare_at_cents, is_featured, category_id, sort_order)
       values ($1, $2, $3, case when $4::int is null then null else now() + ($4 || ' days')::interval end, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        p.id,
        p.availability,
        p.release,
        p.orderByDays,
        p.series,
        p.character,
        p.maker,
        p.jan,
        p.compareAtCents,
        p.featured,
        categoryIds.get(p.category) ?? null,
        i,
      ],
    );
    const drawing = picture(p.drawing ?? p.slug);
    const pictures = p.photo ? [p.photo, drawing] : [drawing];
    for (const [n, url] of pictures.entries()) {
      await db.query(
        'insert into public.product_images (square_item_id, image_url, alt_text, sort_order) values ($1, $2, $3, $4)',
        [p.id, url, p.name, n],
      );
    }
    await db.query(
      'insert into public.sales_stats (square_item_id, rank, units_7d) values ($1, $2, $3)',
      [p.id, p.rank, Math.max(0, 40 - p.rank)],
    );
  }

  let slides = 0;
  const existing = await db.query('select count(*)::int as n from public.hero_slides');
  if (existing.rows[0].n === 0) {
    for (const [i, s] of SAMPLE_SLIDES.entries()) {
      await db.query(
        'insert into public.hero_slides (headline, subheading, image_url, sort_order) values ($1, $2, $3, $4)',
        [s.headline, s.subheading, s.banner ? picture(`banner-${s.banner}`) : null, i],
      );
      slides++;
    }
  }

  // Orders: one per person over the last month, one to three items each, every status represented.
  const orderable = SAMPLE_PRODUCTS.filter(
    (p) =>
      p.availability !== 'hidden' &&
      (p.stock === null || p.stock > 0 || p.availability === 'preorder'),
  );
  for (const [i, [first, last, address1, city, province]] of SAMPLE_PEOPLE.entries()) {
    const status = STATUSES[i % STATUSES.length];
    const items = Array.from(
      { length: 1 + (i % 3) },
      (_, k) => orderable[(i * 7 + k * 13) % orderable.length],
    );
    const preorder = items.some((p) => p.availability === 'preorder');
    const subtotal = items.reduce((sum, p) => sum + p.priceCents, 0);
    const express = i % 4 === 1;
    const shipping = subtotal >= 7500 ? 0 : express ? 1999 : 899;
    const address = JSON.stringify({
      firstName: first,
      lastName: last,
      address1,
      city,
      province,
      postalCode: ['T2P 1J9', 'T5J 1V9', 'V6B 2M4', 'M5H 2M9'][i % 4],
      country: 'CA',
    });
    const email = `${first}.${last}@example.com`.toLowerCase();
    const shipped = status === 'shipped' || status === 'fulfilled';
    const { rows } = await db.query(
      // paid_at as a real payment sets it (when the order was paid), so sales records and stock holds see these orders too
      `insert into public.orders (status, provider, provider_payment_id, subtotal_cents, shipping_cents, tax_cents, total_cents, shipping_method, billing_email, billing_address, shipping_address, tracking_number, carrier, shipped_at, created_at, updated_at, paid_at)
       values ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $9, $10, $11, case when $12 then now() - ($13 || ' hours')::interval else null end, now() - ($14 || ' hours')::interval, now() - ($13 || ' hours')::interval,
               case when $1::public.order_status in ('pending', 'cancelled') then null else now() - ($14 || ' hours')::interval end) returning id`,
      [
        status,
        i % 3 === 2 ? 'square' : 'paypal',
        `SAMPLE-${1000 + i}`,
        subtotal,
        shipping,
        subtotal + shipping,
        express ? 'express' : 'standard',
        email,
        address,
        shipped ? `CA${String(123456789 + i * 1111)}` : null,
        shipped ? 'Canada Post' : null,
        shipped,
        i * 60 + 6,
        i * 60 + 30,
      ],
    );
    for (const p of items) {
      await db.query(
        'insert into public.order_items (order_id, square_item_id, square_variation_id, name, image_url, unit_price_cents, quantity, is_preorder) values ($1, $2, $3, $4, $5, $6, 1, $7)',
        [
          rows[0].id,
          p.id,
          `${p.id}-v`,
          p.name,
          p.photo ?? picture(p.slug),
          p.priceCents,
          p.availability === 'preorder' && preorder,
        ],
      );
    }
  }

  return {
    products: products.length,
    categories: categoryIds.size,
    orders: SAMPLE_PEOPLE.length,
    slides,
  };
}

/** Removes a previously loaded sample set (products, their orders and banners). Categories stay; they are reused. */
export async function clearSample(db: SampleDb) {
  await db.query("delete from public.orders where provider_payment_id like 'SAMPLE-%'");
  await db.query('delete from public.catalog_products where square_item_id like $1', [
    `${SAMPLE_PREFIX}%`,
  ]);
  await db.query('delete from public.hero_slides where headline = any($1::text[])', [
    SAMPLE_SLIDES.map((s) => s.headline),
  ]);
}
