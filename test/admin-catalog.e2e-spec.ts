import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createDatabase, JWT_SECRET, seedProduct, signUp } from './harness.js';

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;
let staff: Awaited<ReturnType<typeof signUp>>;
let customer: Awaited<ReturnType<typeof signUp>>;
let childCategory: string;

const day = 86_400_000;
const list = (qs = '') => http.get(`/admin/catalog${qs ? `?${qs}` : ''}`).set('Authorization', staff.auth);
const names = (res: request.Response) => res.body.items.map((i: any) => i.name);

beforeAll(async () => {
  Object.assign(process.env, { SUPABASE_JWT_SECRET: JWT_SECRET, ALLOWED_ORIGINS: 'http://localhost:5173' });
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());
  staff = await signUp(pglite, 'helper@spinhobby.com', 'staff');
  customer = await signUp(pglite, 'fan@example.com');

  await seedProduct(pglite, { id: 'A1', name: 'Rem Scale Figure', category: 'Figures', priceCents: 22900, stock: 10, series: 'Re:Zero', jan: '4580000000001', featured: true, image: 'https://img/a1.jpg' });
  await seedProduct(pglite, { id: 'A2', name: 'Miku Prize Figure', category: 'Prize Figures', priceCents: 3900, stock: 2, series: 'Vocaloid', image: 'https://img/a2.jpg' });
  await seedProduct(pglite, { id: 'A3', name: 'Sold Out Plush', category: 'Plushies', priceCents: 2500, stock: 0 });
  await seedProduct(pglite, { id: 'A4', name: 'Upcoming Nendoroid', category: 'Nendoroids', priceCents: 8000, availability: 'preorder', orderBy: new Date(Date.now() + 20 * day).toISOString() });
  await seedProduct(pglite, { id: 'A5', name: 'Closed Pre-order Plush', category: 'Plushies', priceCents: 5500, availability: 'preorder', orderBy: new Date(Date.now() - 2 * day).toISOString() });
  await seedProduct(pglite, { id: 'A6', name: 'Hidden Convention Item', category: 'Other', priceCents: 1000, stock: 5, availability: 'hidden' });
  await seedProduct(pglite, { id: 'A7', name: 'Deleted In Square Keychain', category: 'Goods', priceCents: 900, stock: 4 });
  await seedProduct(pglite, { id: 'A8', name: 'Unsellable Badge', category: 'Goods', priceCents: 700, stock: 4 });
  await seedProduct(pglite, { id: 'A9', name: 'Hand Entered Poster', category: 'Goods', priceCents: 1500 });
  await seedProduct(pglite, { id: 'A10', name: 'Hoodie With Sizes', category: 'Apparel', priceCents: 6000, stock: 8 });

  await pglite.query("update public.catalog_products set is_active = false where square_item_id = 'A7'");
  await pglite.query("update public.catalog_variations set is_sellable = false where square_variation_id = 'A8_V'");
  await pglite.query("update public.catalog_products set source = 'manual' where square_item_id = 'A9'");
  await pglite.query("update public.catalog_variations set sku = 'HOOD-M' where square_variation_id = 'A10_V'");
  await pglite.query("insert into public.catalog_variations (square_variation_id, square_item_id, name, sku, price_cents) values ('A10_L', 'A10', 'Large', 'HOOD-L', 6500)");
  await pglite.query("insert into public.inventory_snapshots (square_variation_id, quantity) values ('A10_L', 3)");

  const parent = (await pglite.query<any>("insert into public.store_categories (name) values ('Figures') returning id")).rows[0].id;
  childCategory = (await pglite.query<any>("insert into public.store_categories (name, parent_id) values ('Scale Figures', $1) returning id", [parent])).rows[0].id;
  await pglite.query('update public.product_metadata set category_id = $1 where square_item_id = $2', [childCategory, 'A1']);
  await pglite.query("insert into public.stock_alerts (email, square_variation_id) values ('a@example.com', 'A3_V'), ('b@example.com', 'A3_V')");
});

afterAll(async () => {
  await app?.close();
  await pglite?.close();
});

describe('GET /admin/catalog', () => {
  it('is for staff only', async () => {
    await http.get('/admin/catalog').expect(401);
    await http.get('/admin/catalog').set('Authorization', customer.auth).expect(403);
  });

  it('lists every item, including the ones the storefront hides', async () => {
    const res = await list('limit=100').expect(200);
    expect(res.body.total).toBe(10);
    const storefront = (await http.get('/products?limit=60')).body.items.map((i: any) => i.name);
    for (const hidden of ['Hidden Convention Item', 'Deleted In Square Keychain', 'Unsellable Badge']) {
      expect(storefront).not.toContain(hidden);
      expect(names(res)).toContain(hidden);
    }
  });

  it('labels each item with what an admin needs to know', async () => {
    const byName = Object.fromEntries((await list('limit=100')).body.items.map((i: any) => [i.name, i]));
    expect(Object.fromEntries(Object.entries(byName).map(([n, i]: any) => [n, i.state]))).toEqual({
      'Rem Scale Figure': 'in', 'Miku Prize Figure': 'low', 'Sold Out Plush': 'out', 'Upcoming Nendoroid': 'pre',
      'Closed Pre-order Plush': 'closed', 'Hidden Convention Item': 'hidden', 'Deleted In Square Keychain': 'retired',
      'Unsellable Badge': 'unavailable', 'Hand Entered Poster': 'in', 'Hoodie With Sizes': 'in',
    });
    expect(byName['Deleted In Square Keychain']).toMatchObject({ isActive: false, source: 'square' });
    expect(byName['Unsellable Badge']).toMatchObject({ sellable: false });
    expect(byName['Hand Entered Poster']).toMatchObject({ source: 'manual', stockCount: null });
    expect(byName['Sold Out Plush']).toMatchObject({ alertsWaiting: 2, stockCount: 0 });
    expect(byName['Rem Scale Figure']).toMatchObject({ isFeatured: true, janCode: '4580000000001', series: 'Re:Zero', images: ['https://img/a1.jpg'], categoryId: childCategory, category: 'Scale Figures' });
  });

  it('shows every variation of an item with its SKU, price and stock', async () => {
    const hoodie = (await list('q=hoodie')).body.items[0];
    expect(hoodie.variationCount).toBe(2);
    expect(hoodie.sku).toBe('HOOD-M');
    expect(hoodie.variations).toEqual([
      { id: 'A10_V', name: 'Regular', sku: 'HOOD-M', priceCents: 6000, sellable: true, stockCount: 8, isDefault: true },
      { id: 'A10_L', name: 'Large', sku: 'HOOD-L', priceCents: 6500, sellable: true, stockCount: 3, isDefault: false },
    ]);
  });

  it('counts everything for the filter chips, whatever is filtered', async () => {
    const { counts } = (await list('q=zzzz-nothing')).body;
    expect(counts).toMatchObject({ total: 10, manual: 1, square: 9, featured: 1, alerts: 1 });
    expect(counts.states).toEqual({ in: 3, low: 1, out: 1, pre: 1, closed: 1, unavailable: 1, hidden: 1, retired: 1 });
    expect(counts.noPhoto).toBe(8);
    expect(counts.lastSyncedAt).toBeTruthy();
  });

  describe('search', () => {
    it('finds by name, series, JAN, category and maker, ignoring case', async () => {
      expect(names(await list('q=REM'))).toEqual(['Rem Scale Figure']);
      expect(names(await list('q=vocaloid'))).toEqual(['Miku Prize Figure']);
      expect(names(await list('q=4580000000001'))).toEqual(['Rem Scale Figure']);
      expect(names(await list('q=plushies')).sort()).toEqual(['Closed Pre-order Plush', 'Sold Out Plush']);
    });

    it('finds by SKU and by Square ids, including a non-default variation', async () => {
      expect(names(await list('q=HOOD-L'))).toEqual(['Hoodie With Sizes']);
      expect(names(await list('q=A10_L'))).toEqual(['Hoodie With Sizes']);
      expect(names(await list('q=A7'))).toEqual(['Deleted In Square Keychain']);
    });

    it('needs every word to match, in any order', async () => {
      expect(names(await list('q=figure+rem'))).toEqual(['Rem Scale Figure']);
      expect(names(await list('q=figure+plush'))).toEqual([]);
    });

    it('treats % and _ as plain characters', async () => {
      expect((await list('q=%25')).body.total).toBe(0);
      expect((await list('q=_')).body.total).toBe(0);
    });
  });

  describe('filters', () => {
    it('by status, one or several', async () => {
      expect(names(await list('status=retired'))).toEqual(['Deleted In Square Keychain']);
      expect(names(await list('status=low,out')).sort()).toEqual(['Miku Prize Figure', 'Sold Out Plush']);
      expect((await list('status=hidden,retired,unavailable')).body.total).toBe(3);
    });

    it('by source', async () => {
      expect(names(await list('source=manual'))).toEqual(['Hand Entered Poster']);
      expect((await list('source=square')).body.total).toBe(9);
    });

    it('by shop category, including everything beneath it, or none', async () => {
      const parent = (await pglite.query<any>("select id from public.store_categories where name = 'Figures'")).rows[0].id;
      expect(names(await list(`categoryId=${parent}`))).toEqual(['Rem Scale Figure']);
      expect(names(await list(`categoryId=${childCategory}`))).toEqual(['Rem Scale Figure']);
      expect((await list('categoryId=none')).body.total).toBe(9);
    });

    it('by featured, restock alerts waiting, and missing photo', async () => {
      expect(names(await list('featured=1'))).toEqual(['Rem Scale Figure']);
      expect(names(await list('alerts=1'))).toEqual(['Sold Out Plush']);
      expect((await list('noPhoto=1')).body.total).toBe(8);
    });

    it('by price range in dollars', async () => {
      expect(names(await list('min=50&max=100&sort=price&dir=asc'))).toEqual(['Closed Pre-order Plush', 'Hoodie With Sizes', 'Upcoming Nendoroid']);
      expect(names(await list('max=10&sort=price&dir=asc'))).toEqual(['Unsellable Badge', 'Deleted In Square Keychain', 'Hidden Convention Item']);
    });

    it('combines filters', async () => {
      expect(names(await list('q=plush&status=out'))).toEqual(['Sold Out Plush']);
      expect((await list('q=plush&source=manual')).body.total).toBe(0);
    });

    it('rejects values it does not understand instead of ignoring them', async () => {
      await list('status=nope').expect(400);
      await list('source=ebay').expect(400);
      await list('categoryId=abc').expect(400);
      await list('min=cheap').expect(400);
      await list('sort=color').expect(400);
      await list('sort=name&dir=sideways').expect(400);
    });
  });

  describe('sorting', () => {
    it('by name, A to Z by default and reversible', async () => {
      const asc = names(await list('sort=name&limit=100'));
      expect(asc).toEqual([...asc].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
      expect(names(await list('sort=name&dir=desc&limit=100'))).toEqual([...asc].reverse());
    });

    it('by price, both ways', async () => {
      const prices = async (qs: string) => (await list(qs)).body.items.map((i: any) => i.priceCents);
      const asc = await prices('sort=price&dir=asc&limit=100');
      expect(asc).toEqual([...asc].sort((a, b) => a - b));
      expect(await prices('sort=price&dir=desc&limit=100')).toEqual([...asc].reverse());
    });

    it('by stock, with untracked items last either way', async () => {
      const asc = (await list('sort=stock&dir=asc&limit=100')).body.items.map((i: any) => i.stockCount);
      expect(asc.slice(0, 4)).toEqual([0, 2, 4, 4]);
      expect(asc.slice(-3).every((s: any) => s === null)).toBe(true);
      const desc = (await list('sort=stock&dir=desc&limit=100')).body.items.map((i: any) => i.stockCount);
      expect(desc.slice(0, 2)).toEqual([10, 8]);
      expect(desc.slice(-3).every((s: any) => s === null)).toBe(true);
    });

    it('by status, most healthy first', async () => {
      const order = (await list('sort=status&dir=asc&limit=100')).body.items.map((i: any) => i.state);
      expect(order.at(-1)).toBe('retired');
      expect(order.at(-2)).toBe('hidden');
      expect(order[0]).toBe('in');
    });

    it('by when it was last updated, and by waiting restock alerts', async () => {
      await pglite.query("update public.catalog_products set square_updated_at = now() + interval '1 day' where square_item_id = 'A2'");
      expect(names(await list('sort=updated&limit=1'))).toEqual(['Miku Prize Figure']);
      expect(names(await list('sort=alerts&limit=1'))).toEqual(['Sold Out Plush']);
    });
  });

  describe('paging', () => {
    it('pages with a cursor and reports the total', async () => {
      const first = (await list('sort=name&limit=4')).body;
      expect(first.items).toHaveLength(4);
      expect(first.total).toBe(10);
      expect(first.cursor).toBe('4');
      const second = (await list(`sort=name&limit=4&cursor=${first.cursor}`)).body;
      const third = (await list(`sort=name&limit=4&cursor=${second.cursor}`)).body;
      expect(third.items).toHaveLength(2);
      expect(third.cursor).toBeUndefined();
      expect([...first.items, ...second.items, ...third.items].map((i: any) => i.id)).toHaveLength(new Set([...first.items, ...second.items, ...third.items].map((i: any) => i.id)).size);
    });

    it('keeps the page size within bounds', async () => {
      expect((await list('limit=1000')).body.items).toHaveLength(10);
      expect((await list('limit=0')).body.items.length).toBeGreaterThan(0);
    });
  });

  it('leaves the storefront-shaped admin list as it was', async () => {
    const res = await http.get('/admin/products?limit=60').set('Authorization', staff.auth).expect(200);
    expect(res.body.items.map((i: any) => i.name)).not.toContain('Deleted In Square Keychain');
  });

  describe('Square readiness', () => {
    const readiness = async () => (await http.get('/admin/square/readiness').set('Authorization', staff.auth).expect(200)).body.readiness;

    it('reports the last sync from Square items only', async () => {
      expect((await readiness())).toMatchObject({ catalogAndInventorySyncing: true });
      expect((await readiness()).lastSyncAt).toBeTruthy();
    });

    it('says nothing was synced when every item was added by hand or seeded', async () => {
      await pglite.query("update public.catalog_products set source = 'manual'");
      try {
        expect(await readiness()).toMatchObject({ catalogAndInventorySyncing: false, lastSyncAt: null });
      } finally {
        await pglite.query("update public.catalog_products set source = 'square' where square_item_id <> 'A9'");
      }
    });
  });
});
