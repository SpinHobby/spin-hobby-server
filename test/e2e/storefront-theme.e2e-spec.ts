import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff } = shop;
const theme = async () => (await http.get('/checkout/config').expect(200)).body.theme;

describe('storefront theme', () => {
  it('starts classic, and only the owner can switch it, to a theme the shop has', async () => {
    expect(await theme()).toBe('classic');
    await http
      .put('/admin/settings')
      .set('Authorization', staff.auth)
      .send({ storefront_theme: 'sakura' })
      .expect(403);
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ storefront_theme: 'neon' })
      .expect(400);
    const saved = await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ storefront_theme: 'water-glass' })
      .expect(200);
    expect(saved.body.settings.storefront_theme).toBe('water-glass');
    expect(await theme()).toBe('water-glass');
  });

  it('shows classic for a theme the shop no longer has', async () => {
    await pglite.query("update public.store_settings set storefront_theme = 'retired-theme'");
    expect(await theme()).toBe('classic');
  });
});
