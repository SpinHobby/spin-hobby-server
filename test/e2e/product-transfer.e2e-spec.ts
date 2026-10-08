import { afterAll, describe, expect, it, vi } from 'vitest';
import { CASHIER_CATEGORY_ID } from '../../src/config/square.config.js';
import { SquareCatalogClient } from '../../src/integrations/square/square-catalog.client.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff, shopper } = shop;
const square = shop.app.get(SquareCatalogClient);

const OUR_PHOTO = (name: string) =>
  `https://proj.supabase.co/storage/v1/object/public/product-images/products/2026-10/${name}.webp`;
const SQUARE_PHOTO =
  'https://items-images-sandbox.s3.us-west-2.amazonaws.com/files/new/original.jpeg';

const as = (who: { auth: string }) => ({ Authorization: who.auth });
const catalogItem = async (query: string) =>
  (
    await http
      .get(`/admin/catalog?q=${encodeURIComponent(query)}`)
      .set(as(staff))
      .expect(200)
  ).body.items[0];
const onShop = async (id: string) =>
  (await http.get(`/products?ids=${encodeURIComponent(id)}`)).body.items.map(
    (p: { id: string }) => p.id,
  );

async function createLocal(name: string, extra: Record<string, unknown> = {}) {
  const res = await http
    .post('/admin/products')
    .set(as(staff))
    .send({
      name,
      category: 'Figures',
      description: 'Hand made',
      priceCents: 4200,
      stockCount: 3,
      series: 'Test Series',
      janCode: `49${Math.floor(Math.random() * 1e11)}`,
      imageUrls: [OUR_PHOTO(`${name}-1`), OUR_PHOTO(`${name}-2`)],
      ...extra,
    })
    .expect(200);
  return res.body.product.id as string;
}

describe('hide and show', () => {
  it('hides and shows a product kept in our own database', async () => {
    const id = await createLocal('Local hide test');
    expect(await onShop(id)).toEqual([id]);

    const hidden = await http
      .put(`/admin/products/${id}/visibility`)
      .set(as(staff))
      .send({ visible: false })
      .expect(200);
    expect(hidden.body).toEqual({ success: true, visible: false });
    expect(await onShop(id)).toEqual([]);
    expect(await catalogItem('Local hide test')).toMatchObject({
      state: 'hidden',
      isVisible: false,
      source: 'manual',
    });
    // It is hidden, not deleted: the product and its photos are still in the database.
    expect(await catalogItem('Local hide test')).toMatchObject({ photoSource: 'storage' });

    await http
      .put(`/admin/products/${id}/visibility`)
      .set(as(staff))
      .send({ visible: true })
      .expect(200);
    expect(await onShop(id)).toEqual([id]);
  });

  it('showing a product also clears the older "hidden" availability setting', async () => {
    const id = await createLocal('Local availability test');
    await http
      .patch(`/admin/products/${id}`)
      .set(as(staff))
      .send({ availability: 'hidden' })
      .expect(200);
    expect(await onShop(id)).toEqual([]);
    await http
      .put(`/admin/products/${id}/visibility`)
      .set(as(staff))
      .send({ visible: true })
      .expect(200);
    expect(await onShop(id)).toEqual([id]);
  });

  it('hides a Square product in Square too, and keeps our database in step', async () => {
    const setHidden = vi
      .spyOn(square, 'setItemHidden')
      .mockResolvedValue(['CAT1', CASHIER_CATEGORY_ID]);
    try {
      await http
        .put('/admin/products/CHB1/visibility')
        .set(as(staff))
        .send({ visible: false })
        .expect(200);
      expect(setHidden).toHaveBeenLastCalledWith('CHB1', true);
      expect(await onShop('CHB1')).toEqual([]);
      const row = await pglite.query<{ is_visible: boolean; category_ids: string[] }>(
        "select is_visible, category_ids from public.catalog_products where square_item_id = 'CHB1'",
      );
      expect(row.rows[0]).toEqual({
        is_visible: false,
        category_ids: ['CAT1', CASHIER_CATEGORY_ID],
      });
      expect(await catalogItem('Chibi Figure')).toMatchObject({ state: 'hidden' });

      setHidden.mockResolvedValue(['CAT1']);
      await http
        .put('/admin/products/CHB1/visibility')
        .set(as(staff))
        .send({ visible: true })
        .expect(200);
      expect(setHidden).toHaveBeenLastCalledWith('CHB1', false);
      expect(await onShop('CHB1')).toEqual(['CHB1']);
    } finally {
      setHidden.mockRestore();
    }
  });

  it('leaves our database alone and says why when Square refuses', async () => {
    const setHidden = vi
      .spyOn(square, 'setItemHidden')
      .mockRejectedValue(new Error('Version mismatch.'));
    try {
      const res = await http
        .put('/admin/products/PRZ1/visibility')
        .set(as(staff))
        .send({ visible: false })
        .expect(502);
      expect(res.body.error).toBe('Square said: Version mismatch.');
      expect(await onShop('PRZ1')).toEqual(['PRZ1']); // unchanged
    } finally {
      setHidden.mockRestore();
    }
  });

  it('checks who is asking and what was asked', async () => {
    await http.put('/admin/products/PRZ1/visibility').send({ visible: false }).expect(401);
    await http
      .put('/admin/products/PRZ1/visibility')
      .set(as(shopper))
      .send({ visible: false })
      .expect(403);
    await http
      .put('/admin/products/PRZ1/visibility')
      .set(as(staff))
      .send({ visible: 'no' })
      .expect(400);
    await http
      .put('/admin/products/NOPE/visibility')
      .set(as(staff))
      .send({ visible: true })
      .expect(404, {
        success: false,
        error: 'Product not found.',
      });
  });
});

describe('move a product into Square', () => {
  /** Stands in for Square: what the sync reads back for the new item, plus the photo files and the storage delete. */
  const fakes = () =>
    mockFetch({
      'https://proj.supabase.co/storage/v1/object/public/product-images/': () =>
        new Response(Buffer.from('not-really-a-photo'), {
          headers: { 'content-type': 'image/webp' },
        }),
      'https://proj.supabase.co/storage/v1/object/product-images': () => [],
      '/v2/catalog/batch-retrieve': (init) => {
        const ids = (JSON.parse(String(init?.body)).object_ids ?? []) as string[];
        if (ids.includes('SQ_NEW'))
          return {
            objects: [
              {
                id: 'SQ_NEW',
                type: 'ITEM',
                updated_at: '2026-10-08T00:00:00Z',
                item_data: {
                  name: 'Moved product',
                  description: 'Hand made',
                  categories: [{ id: 'SQCAT' }],
                  image_ids: ['SQ_IMG'],
                  variations: [
                    {
                      id: 'SQ_NEW_V',
                      type: 'ITEM_VARIATION',
                      item_variation_data: { name: 'Regular', price_money: { amount: 4200 } },
                    },
                  ],
                },
              },
            ],
          };
        return { objects: [{ id: 'SQ_IMG', type: 'IMAGE', image_data: { url: SQUARE_PHOTO } }] };
      },
      '/v2/catalog/search': () => ({
        objects: [{ id: 'SQCAT', type: 'CATEGORY', category_data: { name: 'Figures' } }],
      }),
      '/v2/inventory/counts/batch-retrieve': () => ({
        counts: [{ catalog_object_id: 'SQ_NEW_V', quantity: '3' }],
      }),
    });

  /** Square's side of the move: what the cashier-tool client would do, without a network. */
  const squareSpies = (photosSaved?: (count: number) => number) => ({
    category: vi.spyOn(square, 'getOrCreateCategoryId').mockResolvedValue('SQCAT'),
    create: vi.spyOn(square, 'createLocationItem').mockResolvedValue({
      id: 'SQ_NEW',
      item_data: { variations: [{ id: 'SQ_NEW_V' }] },
    }),
    read: vi.spyOn(square, 'getItem').mockResolvedValue({
      item: {
        type: 'ITEM',
        id: 'SQ_NEW',
        itemData: { imageIds: [], variations: [{ id: 'SQ_NEW_V' }] },
      },
      relatedObjects: [],
    } as never),
    photos: vi
      .spyOn(square, 'attachPhotos')
      .mockImplementation((_id, _name, buffers) =>
        Promise.resolve(photosSaved ? photosSaved(buffers.length) : buffers.length),
      ),
    stock: vi.spyOn(square, 'setInitialInventoryCount').mockResolvedValue(undefined),
  });

  it('creates it in Square, carries our extras over, retires the old row and frees the photos', async () => {
    const id = await createLocal('Moved product');
    await http.post('/wishlist').set(as(shopper)).send({ squareItemId: id }).expect(200);
    await http
      .post('/alerts')
      .send({ email: 'wait@example.com', variationId: `${id}-v` })
      .expect(200);
    const spies = squareSpies();
    const net = fakes();
    try {
      const res = await http
        .post(`/admin/products/${id}/transfer-to-square`)
        .set(as(owner))
        .expect(200);
      expect(res.body).toMatchObject({
        success: true,
        id: 'SQ_NEW',
        photosMoved: 2,
        alreadyMoved: false,
      });

      // Square got the product, its category, both photos and the starting stock.
      expect(spies.create).toHaveBeenCalledWith({
        name: 'Moved product',
        description: 'Hand made',
        price: 4200,
        hidden: false,
        categoryId: 'SQCAT',
      });
      expect(spies.photos).toHaveBeenCalledWith('SQ_NEW', 'Moved product', [
        expect.any(Buffer),
        expect.any(Buffer),
      ]);
      expect(spies.stock).toHaveBeenCalledWith('SQ_NEW_V', 3);

      // The new product is a normal Square-mirrored one, with its photo now in Square.
      expect(await catalogItem('Moved product')).toMatchObject({
        id: 'SQ_NEW',
        source: 'square',
        photoSource: 'square',
        series: 'Test Series',
        stockCount: 3,
        state: expect.stringMatching(/^(in|low)$/),
      });
      expect(await onShop('SQ_NEW')).toEqual(['SQ_NEW']);

      // The old hand-entered row is retired and points at its replacement; its photos are gone.
      const old = await pglite.query(
        'select is_active, is_visible, replaced_by from public.catalog_products where square_item_id = $1',
        [id],
      );
      expect(old.rows[0]).toEqual({ is_active: false, is_visible: false, replaced_by: 'SQ_NEW' });
      expect(await onShop(id)).toEqual([]);
      const left = await pglite.query(
        'select count(*)::int as n from public.product_images where square_item_id = $1',
        [id],
      );
      expect(left.rows[0]).toEqual({ n: 0 });
      const deletes = net.calls.filter((c) => c.url.endsWith('/storage/v1/object/product-images'));
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body.prefixes).toEqual([
        'products/2026-10/Moved product-1.webp',
        'products/2026-10/Moved product-2.webp',
      ]);

      // Series/JAN, the wishlist entry and the waiting restock alert moved to the Square product.
      const meta = await pglite.query(
        "select series from public.product_metadata where square_item_id = 'SQ_NEW'",
      );
      expect(meta.rows[0]).toEqual({ series: 'Test Series' });
      const wished = await pglite.query(
        "select count(*)::int as n from public.wishlist_items where square_item_id = 'SQ_NEW'",
      );
      expect(wished.rows[0]).toEqual({ n: 1 });
      const alert = await pglite.query(
        "select square_variation_id from public.stock_alerts where email = 'wait@example.com'",
      );
      expect(alert.rows[0]).toEqual({ square_variation_id: 'SQ_NEW_V' });

      // Doing it again changes nothing and never touches Square again.
      spies.create.mockClear();
      spies.stock.mockClear();
      const again = await http
        .post(`/admin/products/${id}/transfer-to-square`)
        .set(as(owner))
        .expect(200);
      expect(again.body).toMatchObject({ id: 'SQ_NEW', alreadyMoved: true });
      expect(spies.create).not.toHaveBeenCalled();
      expect(spies.stock).not.toHaveBeenCalled();
    } finally {
      net.restore();
      Object.values(spies).forEach((s) => s.mockRestore());
    }
  });

  it('keeps a hidden product hidden in Square', async () => {
    const id = await createLocal('Hidden mover');
    await http
      .put(`/admin/products/${id}/visibility`)
      .set(as(staff))
      .send({ visible: false })
      .expect(200);
    const spies = squareSpies();
    const net = fakes();
    try {
      await http.post(`/admin/products/${id}/transfer-to-square`).set(as(owner)).expect(200);
      expect(spies.create).toHaveBeenCalledWith(expect.objectContaining({ hidden: true }));
    } finally {
      net.restore();
      Object.values(spies).forEach((s) => s.mockRestore());
    }
  });

  it('deletes nothing and can be retried when Square does not accept every photo', async () => {
    const id = await createLocal('Flaky mover');
    const spies = squareSpies((count) => count - 1); // Square keeps one photo fewer than we sent
    const net = fakes();
    try {
      const failed = await http
        .post(`/admin/products/${id}/transfer-to-square`)
        .set(as(owner))
        .expect(502);
      expect(failed.body.error).toMatch(/accepted only 1 of 2 photos/);
      // Our copy is untouched: still active, photos still there, nothing deleted from storage.
      const state = await pglite.query(
        'select is_active, replaced_by from public.catalog_products where square_item_id = $1',
        [id],
      );
      expect(state.rows[0]).toEqual({ is_active: true, replaced_by: 'SQ_NEW' }); // remembers where it went
      const photos = await pglite.query(
        'select count(*)::int as n from public.product_images where square_item_id = $1',
        [id],
      );
      expect(photos.rows[0]).toEqual({ n: 2 });
      expect(net.calls.some((c) => c.url.endsWith('/storage/v1/object/product-images'))).toBe(
        false,
      );

      // Retry: Square now has no photos recorded yet, so it receives both again; it never creates a second item.
      spies.photos.mockImplementation((_i, _n, buffers) => Promise.resolve(buffers.length));
      await http.post(`/admin/products/${id}/transfer-to-square`).set(as(owner)).expect(200);
      expect(spies.create).toHaveBeenCalledTimes(1);
      expect(
        net.calls.filter((c) => c.url.endsWith('/storage/v1/object/product-images')),
      ).toHaveLength(1);
    } finally {
      net.restore();
      Object.values(spies).forEach((s) => s.mockRestore());
    }
  });

  it('only moves what can be moved, and only for the owner', async () => {
    const id = await createLocal('Guarded mover');
    await http.post(`/admin/products/${id}/transfer-to-square`).expect(401);
    await http.post(`/admin/products/${id}/transfer-to-square`).set(as(staff)).expect(403); // owner only
    await http.post('/admin/products/PRZ1/transfer-to-square').set(as(owner)).expect(400, {
      success: false,
      error: 'Only products kept in our own database can be moved into Square.',
    });
    await http.post('/admin/products/manual-nope/transfer-to-square').set(as(owner)).expect(404);
  });
});
