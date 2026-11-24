import { afterAll, describe, expect, it, vi } from 'vitest';
import { SquareCatalogClient } from '../../src/integrations/square/square-catalog.client.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff, shopper } = shop;
const square = shop.app.get(SquareCatalogClient);
const as = { Authorization: staff.auth };

const PHOTO = (n: number) =>
  `https://proj.supabase.co/storage/v1/object/public/product-images/products/2026-10/quick-${n}.webp`;
const JAN = '4901234567894';

/** Stands in for Square and our photo storage. `name` is what Square reports back for the new item. */
const fakes = (copy: { name?: string; images?: string[]; upc?: string; stock?: string } = {}) =>
  mockFetch({
    'https://proj.supabase.co/storage/v1/object/public/product-images/': () =>
      new Response(Buffer.from('not-really-a-photo'), {
        headers: { 'content-type': 'image/webp' },
      }),
    'https://proj.supabase.co/storage/v1/object/product-images': () => [],
    '/v2/catalog/batch-retrieve': (init) => {
      const ids = (JSON.parse(String(init?.body)).object_ids ?? []) as string[];
      if (ids.includes('SQ_QA'))
        return {
          objects: [
            {
              id: 'SQ_QA',
              type: 'ITEM',
              created_at: '2026-10-08T00:00:00Z',
              updated_at: '2026-10-08T00:00:00Z',
              item_data: {
                name: copy.name ?? 'Rem Figure',
                categories: [{ id: 'SQCAT' }],
                image_ids: copy.images ?? ['IMG1', 'IMG2'],
                variations: [
                  {
                    id: 'SQ_QA_V',
                    type: 'ITEM_VARIATION',
                    item_variation_data: {
                      name: 'Regular',
                      price_money: { amount: 4200 },
                      upc: copy.upc ?? JAN,
                    },
                  },
                ],
              },
            },
          ],
        };
      return {
        objects: ids.map((id) => ({
          id,
          type: 'IMAGE',
          image_data: {
            url: `https://items-images-sandbox.s3.us-west-2.amazonaws.com/files/${id}.jpg`,
          },
        })),
      };
    },
    '/v2/catalog/search': () => ({
      objects: [{ id: 'SQCAT', type: 'CATEGORY', category_data: { name: 'Figures' } }],
    }),
    '/v2/inventory/counts/batch-retrieve': () => ({
      counts: [{ catalog_object_id: 'SQ_QA_V', quantity: copy.stock ?? '3' }],
    }),
  });

const spies = () => ({
  category: vi.spyOn(square, 'getOrCreateCategoryId').mockResolvedValue('SQCAT'),
  create: vi.spyOn(square, 'createLocationItem').mockResolvedValue({
    id: 'SQ_QA',
    item_data: { variations: [{ id: 'SQ_QA_V' }] },
  }),
  photos: vi
    .spyOn(square, 'attachPhotos')
    .mockImplementation((_i, _n, buffers) => Promise.resolve(buffers.length)),
  stock: vi.spyOn(square, 'setInitialInventoryCount').mockResolvedValue(null),
  remove: vi.spyOn(square, 'deleteItem').mockResolvedValue(undefined),
});
const restore = (s: ReturnType<typeof spies>, net: { restore: () => void }) => {
  net.restore();
  Object.values(s).forEach((x) => x.mockRestore());
};

const body = (extra: Record<string, unknown> = {}) => ({
  name: 'Rem Figure',
  description: 'A figure of Rem.',
  category: 'Figures',
  priceCents: 4200,
  stockCount: 3,
  imageUrls: [PHOTO(1), PHOTO(2)],
  barcode: JAN,
  series: 'Re:Zero',
  ...extra,
});

describe('add a product straight into Square', () => {
  it('creates it in Square with its barcode, photos and stock, and shows it in our shop right away', async () => {
    const s = spies();
    const net = fakes();
    try {
      const res = await http
        .post('/admin/products/quick-add')
        .set(as)
        .send(
          body({
            manufacturer: 'Banpresto',
            productLine: 'Relax Time',
            productType: 'Prize Figure',
          }),
        )
        .expect(200);
      expect(res.body).toMatchObject({ success: true, product: { id: 'SQ_QA', photos: 2 } });
      expect(s.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Rem Figure',
          price: 4200,
          upc: JAN,
          hidden: false,
          categoryId: 'SQCAT',
        }),
      );
      expect(s.photos).toHaveBeenCalledWith('SQ_QA', 'Rem Figure', [
        expect.any(Buffer),
        expect.any(Buffer),
      ]);
      expect(s.stock).toHaveBeenCalledWith('SQ_QA_V', 3);

      const listed = (await http.get('/admin/catalog?q=SQ_QA').set(as).expect(200)).body.items[0];
      expect(listed).toMatchObject({
        id: 'SQ_QA',
        source: 'square',
        series: 'Re:Zero',
        janCode: JAN,
        stockCount: 3,
        photoSource: 'square',
        manufacturer: 'Banpresto',
        productLine: 'Relax Time',
      });
      const shop = (await http.get('/products?ids=SQ_QA')).body.items;
      expect(shop.map((p: { id: string }) => p.id)).toEqual(['SQ_QA']);
      // the product's page has them
      expect((await http.get('/square/catalog/SQ_QA').expect(200)).body.item).toMatchObject({
        manufacturer: 'Banpresto',
        productLine: 'Relax Time',
        productType: 'Prize Figure',
      });
      // collectors search for the line
      const found = (await http.get('/products?q=relax%20time')).body.items;
      expect(found.map((p: { id: string }) => p.id)).toContain('SQ_QA');
      // the product editor changes or clears it
      await http
        .patch('/admin/products/SQ_QA')
        .set(as)
        .send({ product_line: 'Relax Time Vol. 2' })
        .expect(200);
      expect((await http.get('/admin/catalog?q=SQ_QA').set(as)).body.items[0].productLine).toBe(
        'Relax Time Vol. 2',
      );
      // and the product type the same way
      await http
        .patch('/admin/products/SQ_QA')
        .set(as)
        .send({ product_type: 'Scale Figure' })
        .expect(200);
      expect((await http.get('/admin/catalog?q=SQ_QA').set(as)).body.items[0].productType).toBe(
        'Scale Figure',
      );
      await http
        .patch('/admin/products/SQ_QA')
        .set(as)
        .send({ product_type: 'x'.repeat(61) })
        .expect(400);
      await http.patch('/admin/products/SQ_QA').set(as).send({ product_line: '' }).expect(200);
      expect(
        (await http.get('/admin/catalog?q=SQ_QA').set(as)).body.items[0].productLine,
      ).toBeNull();
      // The temporary uploads are removed from our storage; the photos live in Square now.
      const deletes = net.calls.filter((c) => c.url.endsWith('/storage/v1/object/product-images'));
      expect(deletes).toHaveLength(1);
    } finally {
      restore(s, net);
    }
  });

  it('keeps a hidden listing off the website', async () => {
    await pglite.query("delete from public.catalog_products where square_item_id = 'SQ_QA'");
    const s = spies();
    const net = fakes();
    try {
      await http
        .post('/admin/products/quick-add')
        .set(as)
        .send(body({ hidden: true }))
        .expect(200);
      expect(s.create).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }));
    } finally {
      restore(s, net);
    }
  });

  it('undoes everything when Square keeps fewer photos than were sent', async () => {
    await pglite.query("delete from public.catalog_products where square_item_id = 'SQ_QA'");
    const s = spies();
    s.photos.mockResolvedValue(1);
    const net = fakes();
    try {
      const res = await http.post('/admin/products/quick-add').set(as).send(body()).expect(502);
      expect(res.body.error).toMatch(/accepted only 1 of 2 photos/);
      expect(res.body.error).toMatch(/Nothing was added/);
      expect(s.remove).toHaveBeenCalledWith('SQ_QA');
      const left = await pglite.query(
        "select count(*)::int as n from public.catalog_products where square_item_id = 'SQ_QA'",
      );
      expect(left.rows[0]).toEqual({ n: 0 });
      // The uploaded photos were not deleted, so the form can simply be submitted again.
      expect(net.calls.some((c) => c.url.endsWith('/storage/v1/object/product-images'))).toBe(
        false,
      );
    } finally {
      restore(s, net);
    }
  });

  it('undoes everything when the new item does not match what was entered', async () => {
    await pglite.query("delete from public.catalog_products where square_item_id = 'SQ_QA'");
    const s = spies();
    const net = fakes({ name: 'Something else' });
    try {
      const res = await http.post('/admin/products/quick-add').set(as).send(body()).expect(502);
      expect(res.body.error).toMatch(/the name differs/);
      expect(s.remove).toHaveBeenCalledWith('SQ_QA');
    } finally {
      restore(s, net);
    }
  });

  it('refuses a barcode with a wrong check digit, and checks who is asking', async () => {
    await http.post('/admin/products/quick-add').send(body()).expect(401);
    await http
      .post('/admin/products/quick-add')
      .set({ Authorization: shopper.auth })
      .send(body())
      .expect(403);
    const res = await http
      .post('/admin/products/quick-add')
      .set(as)
      .send(body({ barcode: '4901234567895' }))
      .expect(400);
    expect(res.body.error).toMatch(/barcode is not valid/);
    await http
      .post('/admin/products/quick-add')
      .set(as)
      .send(body({ name: '' }))
      .expect(400);
  });
});

describe('the stock of a new product', () => {
  it('keeps the count Square confirmed when set, though reading it back straight after still shows 0 (the live admin, 2026-11-19)', async () => {
    const s = spies();
    s.stock.mockResolvedValue(3);
    const net = fakes({ stock: '0' });
    try {
      await http.post('/admin/products/quick-add').set(as).send(body()).expect(200);
      const listed = (await http.get('/admin/catalog?q=SQ_QA').set(as).expect(200)).body.items[0];
      expect(listed).toMatchObject({ id: 'SQ_QA', stockCount: 3 });
    } finally {
      restore(s, net);
    }
  });

  it('undoes the new item when Square counted a different stock than entered', async () => {
    const s = spies();
    s.stock.mockResolvedValue(2);
    const net = fakes();
    try {
      const res = await http.post('/admin/products/quick-add').set(as).send(body()).expect(502);
      expect(res.body.error).toMatch(/Square counted 2 in stock, not 3\. Nothing was added/);
    } finally {
      restore(s, net);
    }
  });
});

describe('barcode lookup and restock', () => {
  it('finds the product that already has a barcode, in Square data or our own JAN field', async () => {
    await pglite.query("delete from public.catalog_products where square_item_id = 'SQ_QA'");
    const s = spies();
    const net = fakes();
    try {
      await http.post('/admin/products/quick-add').set(as).send(body()).expect(200);
      const found = await http.get(`/admin/products/by-barcode/${JAN}`).set(as).expect(200);
      expect(found.body.product).toMatchObject({
        id: 'SQ_QA',
        name: 'Rem Figure',
        source: 'square',
      });
      expect(
        (await http.get('/admin/products/by-barcode/96385074').set(as).expect(200)).body.product,
      ).toBeNull();
      await http.get('/admin/products/by-barcode/123').set(as).expect(400);

      // Restock: adds to what Square holds, then re-reads it.
      const counts = vi.spyOn(square, 'getInventoryCounts').mockResolvedValue({ SQ_QA_V: 3 });
      const res = await http
        .post('/admin/products/SQ_QA/add-stock')
        .set(as)
        .send({ quantity: 4 })
        .expect(200);
      expect(res.body).toEqual({ success: true, stockCount: 7 });
      expect(s.stock).toHaveBeenLastCalledWith('SQ_QA_V', 7);
      counts.mockRestore();
      await http.post('/admin/products/SQ_QA/add-stock').set(as).send({ quantity: 0 }).expect(400);
      await http.post('/admin/products/NOPE/add-stock').set(as).send({ quantity: 1 }).expect(404);
    } finally {
      restore(s, net);
    }
  });
});
void owner;
