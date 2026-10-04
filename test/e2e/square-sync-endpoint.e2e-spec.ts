import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff } = shop;

describe('square catalog sync', () => {
  it('mirrors Square items, variations, images and stock', async () => {
    const square = mockFetch({
      '/v2/catalog/search-catalog-items': () => ({
        items: [
          {
            id: 'SQ_ITEM',
            type: 'ITEM',
            updated_at: '2026-09-01T00:00:00Z',
            item_data: {
              name: 'Synced Plushie',
              description_plaintext: 'Soft',
              categories: [{ id: 'CAT1' }],
              image_ids: ['IMG1'],
              variations: [
                {
                  id: 'SQ_VAR',
                  type: 'ITEM_VARIATION',
                  item_variation_data: {
                    name: 'Regular',
                    price_money: { amount: 3200, currency: 'CAD' },
                  },
                },
              ],
            },
          },
        ],
        related_objects: [
          { id: 'IMG1', type: 'IMAGE', image_data: { url: 'https://sq/img1.jpg' } },
        ],
      }),
      '/v2/catalog/search': () => ({
        objects: [{ id: 'CAT1', type: 'CATEGORY', category_data: { name: 'Plushies' } }],
      }),
      '/v2/inventory/counts/batch-retrieve': () => ({
        counts: [{ catalog_object_id: 'SQ_VAR', quantity: '4' }],
      }),
    });
    try {
      await http.post('/admin/square/sync').set('Authorization', staff.auth).expect(403); // owner only
      const res = await http
        .post('/admin/square/sync')
        .set('Authorization', owner.auth)
        .expect(200);
      expect(res.body.sync).toMatchObject({ products: 1, variations: 1, inventory: 1 });
      await http.post('/square-sync').expect(403);
      const product = (await http.get('/square/catalog/SQ_ITEM').expect(200)).body.item;
      expect(product).toMatchObject({
        name: 'Synced Plushie',
        category: 'Plushies',
        priceCents: 3200,
        stockCount: 4,
        status: 'in',
        images: ['https://sq/img1.jpg'],
      });
      const readiness = (
        await http.get('/admin/square/readiness').set('Authorization', staff.auth).expect(200)
      ).body.readiness;
      expect(readiness).toMatchObject({
        appAndLocationConnected: true,
        catalogAndInventorySyncing: true,
        webhookKeySet: true,
        activeProvider: 'paypal',
      });
    } finally {
      square.restore();
    }
  });
});
