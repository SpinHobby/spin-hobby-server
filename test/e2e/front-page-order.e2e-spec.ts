import { afterAll, describe, expect, it, vi } from 'vitest';
import { SquareCatalogClient } from '../../src/integrations/square/square-catalog.client.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;
const as = { Authorization: staff.auth };
const square = shop.app.get(SquareCatalogClient);

const homepage = async () =>
  ((await http.get('/homepage').expect(200)).body.featuredItems as { id: string }[]).map(
    (p) => p.id,
  );
const feature = (id: string) =>
  http.patch(`/admin/products/${id}`).set(as).send({ is_featured: true }).expect(200);
const catalog = async (query = '') =>
  (await http.get(`/admin/catalog?${query}`).set(as).expect(200)).body;
const rankOf = async (id: string) =>
  (await catalog('limit=100')).items.find((i: { id: string }) => i.id === id)?.frontPage;
const reorder = (ids: string[]) =>
  http.put('/admin/products/front-page-order').set(as).send({ ids });

describe('front page order', () => {
  it('puts a newly featured product at the end of the front page', async () => {
    expect(await homepage()).toEqual(['FIG1']);
    await feature('PRZ1');
    await feature('CHB1');
    expect(await homepage()).toEqual(['FIG1', 'PRZ1', 'CHB1']);
    expect(await rankOf('FIG1')).toBe(1);
    expect(await rankOf('PRZ1')).toBe(2);
    expect(await rankOf('CHB1')).toBe(3);
    expect(await rankOf('BDG1')).toBeNull(); // not featured: no place on the front page
  });

  it('saves a new order in one go, and keeps products that were left out after the listed ones', async () => {
    await reorder(['CHB1', 'FIG1']).expect(200, { success: true });
    expect(await homepage()).toEqual(['CHB1', 'FIG1', 'PRZ1']);

    // Listing a product that is not featured yet features it.
    await reorder(['BDG1', 'PRZ1']).expect(200);
    expect(await homepage()).toEqual(['BDG1', 'PRZ1', 'CHB1', 'FIG1']);
    expect(await rankOf('BDG1')).toBe(1);

    const sorted = await catalog('featured=1&sort=front');
    expect(sorted.frontPageSlots).toBe(8);
    expect(sorted.items.map((i: { id: string }) => i.id)).toEqual(['BDG1', 'PRZ1', 'CHB1', 'FIG1']);
  });

  it('does not give a slot to a featured product shoppers cannot see', async () => {
    const hide = vi.spyOn(square, 'setItemHidden').mockResolvedValue([]);
    await http.put('/admin/products/PRZ1/visibility').set(as).send({ visible: false }).expect(200);
    expect(await homepage()).toEqual(['BDG1', 'CHB1', 'FIG1']);
    expect(await rankOf('PRZ1')).toBeNull();
    expect(await rankOf('CHB1')).toBe(2); // the ranks follow what shoppers really see
    await http.put('/admin/products/PRZ1/visibility').set(as).send({ visible: true }).expect(200);
    hide.mockRestore();
  });

  it('checks who is asking and what was asked', async () => {
    await http
      .put('/admin/products/front-page-order')
      .send({ ids: ['FIG1'] })
      .expect(401);
    await http
      .put('/admin/products/front-page-order')
      .set({ Authorization: shopper.auth })
      .send({ ids: ['FIG1'] })
      .expect(403);
    await reorder([]).expect(400);
    await reorder(['FIG1', 'FIG1']).expect(400);
    await reorder(['FIG1', 7 as never]).expect(400);
    await reorder(['FIG1', 'NOPE']).expect(404, { success: false, error: 'Product not found.' });
    // A refused request changes nothing.
    expect(await homepage()).toEqual(['BDG1', 'PRZ1', 'CHB1', 'FIG1']);
  });
});
