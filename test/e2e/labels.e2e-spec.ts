import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch, seedProduct } from '../support/harness.js';
import { past, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, staff, shopper } = shop;
const as = (who: { auth: string }) => ({ Authorization: who.auth });

const skuOf = async (variation: string) =>
  (
    await pglite.query<{ sku: string | null }>(
      'select sku from public.catalog_variations where square_variation_id = $1',
      [variation],
    )
  ).rows[0]?.sku;

describe('recently changed filter and select all', () => {
  it('lists only products added or changed in the last N hours', async () => {
    await pglite.query(
      `update public.catalog_products set square_created_at = $1, square_updated_at = $1, created_at = $1`,
      [past(10)],
    );
    // updated_at moves with any write (the trigger), so it stands in for "changed" only on hand-entered products
    await pglite.query(
      `update public.catalog_products set source = 'manual', square_created_at = null, square_updated_at = null where square_item_id = 'CHB1'`,
    );
    await pglite.query(
      `update public.catalog_products set source = 'square' where square_item_id <> 'CHB1'`,
    );
    await pglite.query(
      `update public.catalog_products set square_updated_at = now() - interval '2 hours' where square_item_id = 'PRZ1'`,
    );
    await pglite.query(
      `update public.catalog_products set square_created_at = now() - interval '30 hours', square_updated_at = now() - interval '30 hours' where square_item_id = 'BDG1'`,
    );

    const res = await http.get('/admin/catalog?changedWithin=24').set(as(staff)).expect(200);
    const ids = res.body.items.map((p: { id: string }) => p.id).sort();
    expect(ids).toEqual(['CHB1', 'PRZ1']);
    expect(res.body.counts.total).toBeGreaterThan(2); // the chips still count the whole catalog

    const week = await http.get('/admin/catalog?changedWithin=48').set(as(staff)).expect(200);
    expect(week.body.items.map((p: { id: string }) => p.id).sort()).toEqual([
      'BDG1',
      'CHB1',
      'PRZ1',
    ]);

    await http.get('/admin/catalog?changedWithin=soon').set(as(staff)).expect(400);
  });

  it('returns every matching id across pages, in list order', async () => {
    const res = await http
      .get('/admin/catalog/ids?changedWithin=48&sort=name&dir=asc')
      .set(as(staff))
      .expect(200);
    expect(res.body).toEqual({
      success: true,
      ids: ['BDG1', 'CHB1', 'PRZ1'],
      truncated: false,
    });
    const all = await http.get('/admin/catalog/ids').set(as(staff)).expect(200);
    expect(all.body.ids.length).toBe(6);
    await http.get('/admin/catalog/ids').set(as(shopper)).expect(403);
  });
});

describe('sticker labels', () => {
  it('gives products without a SKU a shop SKU, saved in Square first, and keeps existing SKUs', async () => {
    await pglite.query(
      `update public.catalog_variations set sku = 'MIKU-01' where square_variation_id = 'PRZ1_V'`,
    );
    const fetches = mockFetch({
      '/v2/catalog/batch-retrieve': (init) => {
        const { object_ids } = JSON.parse(String(init?.body));
        return {
          objects: object_ids.map((id: string) => ({
            type: 'ITEM_VARIATION',
            id,
            version: 7,
            updated_at: '2026-10-01T00:00:00Z',
            item_variation_data: {
              item_id: id.replace('_V', ''),
              name: 'Regular',
              price_money: { amount: 100, currency: 'CAD' },
            },
          })),
        };
      },
      '/v2/catalog/batch-upsert': () => ({ objects: [] }),
    });
    try {
      const res = await http
        .post('/admin/products/labels')
        .set(as(staff))
        .send({ ids: ['PRZ1', 'FIG1', 'CHB1'] })
        .expect(200);
      expect(res.body.assigned).toBe(2);
      const [miku, rem, chibi] = res.body.labels;
      expect(miku).toMatchObject({
        id: 'PRZ1',
        name: 'Miku Prize Figure',
        series: 'Vocaloid',
        code: 'MIKU-01',
        inSquare: true,
        upc: null,
        stock: 12,
      });
      expect(rem.code).toMatch(/^SH-[2-9A-HJKMNP-Z]{6}$/);
      expect(rem.inSquare).toBe(true);
      expect(chibi.inSquare).toBe(false); // hand-entered: the SKU is kept here only
      expect(chibi.code).toMatch(/^SH-/);
      expect(chibi.code).not.toBe(rem.code);

      // Only the Square product went to Square, with every other field sent back as read
      const upsert = fetches.calls.find((c) => c.url.includes('batch-upsert'))!;
      const objects = upsert.body.batches[0].objects;
      expect(objects).toHaveLength(1);
      expect(objects[0]).toMatchObject({
        id: 'FIG1_V',
        version: 7,
        item_variation_data: { sku: rem.code, name: 'Regular' },
      });
      expect(objects[0].updated_at).toBeUndefined();

      expect(await skuOf('FIG1_V')).toBe(rem.code);
      expect(await skuOf('CHB1_V')).toBe(chibi.code);

      // Asking again changes nothing: the same codes come back and Square is not called
      const before = fetches.calls.length;
      const again = await http
        .post('/admin/products/labels')
        .set(as(staff))
        .send({ ids: ['FIG1', 'CHB1'] })
        .expect(200);
      expect(again.body.assigned).toBe(0);
      expect(again.body.labels.map((l: { code: string }) => l.code)).toEqual([
        rem.code,
        chibi.code,
      ]);
      expect(fetches.calls.length).toBe(before);
    } finally {
      fetches.restore();
    }
  });

  it('makes no labels and saves nothing when Square refuses the SKUs', async () => {
    const fetches = mockFetch({
      '/v2/catalog/batch-retrieve': () => ({
        objects: [
          {
            type: 'ITEM_VARIATION',
            id: 'BDG1_V',
            version: 1,
            item_variation_data: { item_id: 'BDG1' },
          },
        ],
      }),
      '/v2/catalog/batch-upsert': () =>
        new Response(JSON.stringify({ errors: [{ detail: 'Version mismatch' }] }), { status: 400 }),
    });
    try {
      const res = await http
        .post('/admin/products/labels')
        .set(as(staff))
        .send({ ids: ['BDG1'] })
        .expect(502);
      expect(res.body.error).toContain('Version mismatch');
      expect(await skuOf('BDG1_V')).toBeNull();
    } finally {
      fetches.restore();
    }
  });

  it('checks the request and who is asking', async () => {
    await http.post('/admin/products/labels').set(as(staff)).send({ ids: [] }).expect(400);
    await http
      .post('/admin/products/labels')
      .set(as(staff))
      .send({ ids: ['NOPE'] })
      .expect(404);
    await http
      .post('/admin/products/labels')
      .set(as(shopper))
      .send({ ids: ['FIG1'] })
      .expect(403);
  });

  it('leaves a product deleted in Square without a code', async () => {
    await seedProduct(pglite, {
      id: 'GONE1',
      name: 'Retired Keychain',
      category: 'Other',
      priceCents: 900,
    });
    await pglite.query(
      `update public.catalog_products set is_active = false where square_item_id = 'GONE1'`,
    );
    const res = await http
      .post('/admin/products/labels')
      .set(as(staff))
      .send({ ids: ['GONE1'] })
      .expect(200);
    expect(res.body.labels[0]).toMatchObject({ code: null, inSquare: false });
  });
});
