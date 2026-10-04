import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApp,
  createDatabase,
  JWT_SECRET,
  mockFetch,
  seedProduct,
  signUp,
} from './harness.js';

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;
let owner: Awaited<ReturnType<typeof signUp>>;

type Variation = { id: string; track?: boolean; deleted?: boolean };
type CatalogItem = {
  id: string;
  name: string;
  variations: Variation[];
  images?: string[];
  deleted?: boolean;
};

const item = (i: CatalogItem) => ({
  id: i.id,
  type: 'ITEM',
  updated_at: '2026-09-01T00:00:00Z',
  is_deleted: i.deleted ?? false,
  item_data: {
    name: i.name,
    categories: [{ id: 'CAT1' }],
    image_ids: i.images ?? [],
    variations: i.variations.map((v) => ({
      id: v.id,
      type: 'ITEM_VARIATION',
      is_deleted: v.deleted ?? false,
      item_variation_data: {
        name: v.id,
        price_money: { amount: 1000, currency: 'CAD' },
        ...(v.track === undefined ? {} : { track_inventory: v.track }),
      },
    })),
  },
});

/** Square returns `pages` in order (the request's cursor picks the page) and a count of 4 for every tracked variation asked about. */
function squareCatalog(pages: CatalogItem[][]) {
  return mockFetch({
    '/v2/catalog/search-catalog-items': (init) => {
      const cursor = JSON.parse(String(init?.body)).cursor as string | undefined;
      const page = cursor ? Number(cursor) : 0;
      return {
        items: pages[page].map(item),
        related_objects: [
          { id: 'IMG1', type: 'IMAGE', image_data: { url: 'https://sq/img1.jpg' } },
          { id: 'IMG2', type: 'IMAGE', image_data: { url: 'https://sq/img2.jpg' } },
        ],
        ...(page + 1 < pages.length ? { cursor: String(page + 1) } : {}),
      };
    },
    '/v2/catalog/search': () => ({
      objects: [{ id: 'CAT1', type: 'CATEGORY', category_data: { name: 'Plushies' } }],
    }),
    '/v2/inventory/counts/batch-retrieve': (init) => ({
      counts: (JSON.parse(String(init?.body)).catalog_object_ids as string[]).map((id) => ({
        catalog_object_id: id,
        quantity: '4',
      })),
    }),
  });
}

const sync = async () =>
  (await http.post('/admin/square/sync').set('Authorization', owner.auth).expect(200)).body.sync;
const run = async (pages: CatalogItem[][]) => {
  const square = squareCatalog(pages);
  try {
    return { result: await sync(), calls: square.calls };
  } finally {
    square.restore();
  }
};
const product = async (id: string) =>
  (
    await pglite.query<any>(
      'select is_active, is_visible, default_variation_id from public.catalog_products where square_item_id = $1',
      [id],
    )
  ).rows[0];
const variation = async (id: string) =>
  (
    await pglite.query<any>(
      'select is_sellable from public.catalog_variations where square_variation_id = $1',
      [id],
    )
  ).rows[0];
const stock = async (id: string) =>
  (
    await pglite.query<any>(
      'select quantity from public.inventory_snapshots where square_variation_id = $1',
      [id],
    )
  ).rows[0];

const A: CatalogItem = {
  id: 'ITEM_A',
  name: 'Plush A',
  images: ['IMG1', 'IMG2'],
  variations: [{ id: 'A1' }, { id: 'A2', track: false }],
};
const B: CatalogItem = { id: 'ITEM_B', name: 'Plush B', variations: [{ id: 'B1', track: true }] };
const C: CatalogItem = { id: 'ITEM_C', name: 'Plush C', variations: [{ id: 'C1' }] };

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_JWT_SECRET: JWT_SECRET,
    OWNER_EMAILS: 'boss@spinhobby.com',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SQUARE_ACCESS_TOKEN: 'sq-token',
    SQUARE_LOCATION_ID: 'LOC1',
    SQUARE_ENV: 'sandbox',
  });
  delete process.env.SQUARE_SYNC_RETIRE_MAX_RATIO;
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());
  owner = await signUp(pglite, 'boss@spinhobby.com');
  // A hand-entered product: Square must never see, change or retire it.
  await seedProduct(pglite, {
    id: 'MANUAL1',
    name: 'Convention Exclusive',
    category: 'Other',
    priceCents: 2000,
    stock: 3,
  });
  await pglite.query(
    "update public.catalog_products set source = 'manual' where square_item_id = 'MANUAL1'",
  );
});

afterAll(async () => {
  delete process.env.SQUARE_SYNC_RETIRE_MAX_RATIO;
  await app?.close();
  await pglite?.close();
});

describe('square catalog sync', () => {
  it('mirrors every page in bulk and treats tracking-off variations as unlimited', async () => {
    const { result, calls } = await run([[A, B], [C]]);
    expect(result).toMatchObject({ products: 3, variations: 4, inventory: 4, retired: 0 });

    expect(
      (
        await pglite.query<any>(
          "select count(*)::int as n from public.catalog_products where square_item_id like 'ITEM_%'",
        )
      ).rows[0].n,
    ).toBe(3);
    expect((await product('ITEM_A')).default_variation_id).toBe('A1');
    const images = await pglite.query<any>(
      "select image_url from public.product_images where square_item_id = 'ITEM_A' order by sort_order",
    );
    expect(images.rows.map((r) => r.image_url)).toEqual([
      'https://sq/img1.jpg',
      'https://sq/img2.jpg',
    ]);

    expect(await stock('A1')).toEqual({ quantity: 4 });
    expect(await stock('A2')).toEqual({ quantity: null }); // tracking off: not "0 in stock"
    const asked = calls
      .filter((c) => c.url.includes('batch-retrieve'))
      .flatMap((c) => c.body.catalog_object_ids);
    expect(asked).not.toContain('A2');

    const quote = await http
      .post('/cart/quote')
      .send({
        items: [{ variationId: 'A2', quantity: 5 }],
        shippingMethod: 'standard',
        country: 'CA',
        province: 'AB',
      })
      .expect(200);
    expect(quote.body.warnings).toEqual([]);
    expect(quote.body.lines[0].quantity).toBe(5);
  });

  it('makes variations that Square dropped unsellable, and keeps updating the rest', async () => {
    await run([[{ ...A, variations: [{ id: 'A1' }] }, B, C]]);
    expect((await variation('A2')).is_sellable).toBe(false);
    expect((await variation('A1')).is_sellable).toBe(true);
    const quote = await http
      .post('/cart/quote')
      .send({
        items: [{ variationId: 'A2', quantity: 1 }],
        shippingMethod: 'standard',
        country: 'CA',
        province: 'AB',
      })
      .expect(200);
    expect(quote.body.warnings).toEqual([expect.objectContaining({ code: 'OUT_OF_STOCK' })]);
  });

  it('retires items deleted in Square but never hand-entered ones', async () => {
    const { result } = await run([[{ ...A, variations: [{ id: 'A1' }] }, B]]); // C is gone: 1 of 3 active
    expect(result.retired).toBe(1);
    expect((await product('ITEM_C')).is_active).toBe(false);
    expect((await product('ITEM_A')).is_active).toBe(true);
    expect((await product('MANUAL1')).is_active).toBe(true);
    expect((await http.get('/products?q=Plush%20C')).body.items).toEqual([]);
  });

  it('brings an item back when it reappears in Square', async () => {
    const { result } = await run([[A, B, C]]);
    expect(result.retired).toBe(0);
    expect((await product('ITEM_C')).is_active).toBe(true);
    expect((await variation('A2')).is_sellable).toBe(true);
  });

  it('refuses to retire most of the catalog from one suspicious read', async () => {
    const { result } = await run([[A]]); // would retire B and C: 2 of 3
    expect(result.retired).toBe(0);
    expect((await product('ITEM_B')).is_active).toBe(true);
    expect((await product('ITEM_C')).is_active).toBe(true);

    process.env.SQUARE_SYNC_RETIRE_MAX_RATIO = '1'; // the owner really did delete them
    try {
      expect((await run([[A]])).result.retired).toBe(2);
    } finally {
      delete process.env.SQUARE_SYNC_RETIRE_MAX_RATIO;
    }
    expect((await product('ITEM_B')).is_active).toBe(false);
  });

  it('never retires anything when Square returns no items', async () => {
    process.env.SQUARE_SYNC_RETIRE_MAX_RATIO = '1';
    try {
      expect((await run([[]])).result.retired).toBe(0);
    } finally {
      delete process.env.SQUARE_SYNC_RETIRE_MAX_RATIO;
    }
    expect((await product('ITEM_A')).is_active).toBe(true);
  });
});
