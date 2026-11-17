import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff } = shop;

describe('storefront layout', () => {
  it('starts as the default layout, and the owner can change it for every shopper', async () => {
    const before = (await http.get('/checkout/config').expect(200)).body.layout;
    expect(before.productView).toBe('grid');
    expect(before.sections[0]).toEqual({ id: 'hero', visible: true });

    await http
      .put('/admin/settings')
      .set('Authorization', staff.auth)
      .send({ storefront_layout: { columns: 4 } })
      .expect(403);
    const saved = await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({
        storefront_layout: {
          sections: [{ id: 'shop' }, { id: 'events', visible: false }],
          productView: 'compact',
          columns: 5,
          imageShape: 'portrait',
          sidebar: 'hidden',
          width: 'wide',
          announcementBar: false,
          logo: 'wordmark',
        },
      })
      .expect(200);
    expect(saved.body.settings.storefront_layout.columns).toBe(5);
    expect(saved.body.settings.storefront_layout.logo).toBe('wordmark');

    const after = (await http.get('/checkout/config').expect(200)).body.layout;
    expect(after.sections.slice(0, 3)).toEqual([
      { id: 'shop', visible: true },
      { id: 'events', visible: false },
      { id: 'hero', visible: true },
    ]);
    expect(after).toMatchObject({
      productView: 'compact',
      imageShape: 'portrait',
      sidebar: 'hidden',
      width: 'wide',
      announcementBar: false,
    });
    expect(
      (await http.get('/admin/settings').set('Authorization', staff.auth).expect(200)).body.settings
        .storefront_layout.width,
    ).toBe('wide');

    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ storefront_layout: { columns: 12 } })
      .expect(400);

    // null puts the default layout back
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ storefront_layout: null })
      .expect(200);
    expect((await http.get('/checkout/config').expect(200)).body.layout.productView).toBe('grid');
  });
});
