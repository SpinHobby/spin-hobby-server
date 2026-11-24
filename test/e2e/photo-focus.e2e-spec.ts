import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(() => shop.close());
const { http, staff, shopper, pglite } = shop;
const asStaff = { Authorization: staff.auth };
const PHOTO = 'https://sq.example/rem-face.jpg';

await pglite.query(
  'insert into public.product_images (square_item_id, image_url, sort_order) values ($1, $2, 7)',
  ['FIG1', PHOTO],
);

describe('photo focus (where the face is)', () => {
  it('saves a point, lists it, and sends it with the products behind a banner ad', async () => {
    expect(
      (await http.get('/admin/products/FIG1/photo-focus').set(asStaff).expect(200)).body.focus,
    ).toEqual({});
    const saved = await http
      .put('/admin/products/FIG1/photo-focus')
      .set(asStaff)
      .send({ url: PHOTO, x: 48, y: 18.126, zoom: 1.8 })
      .expect(200);
    expect(saved.body.focus).toEqual({ [PHOTO]: { x: 48, y: 18.13, zoom: 1.8 } });

    const ad = (
      await http
        .post('/admin/homepage/slides')
        .set(asStaff)
        .send({ headline: 'Rem', isVisible: true, backdrop: 'chosen', productIds: ['FIG1'] })
        .expect(200)
    ).body.slide;
    const live = (await http.get('/homepage').expect(200)).body.slides.find(
      (s: { id: string }) => s.id === ad.id,
    );
    expect(live.products.map((p: { id: string }) => p.id)).toEqual(['FIG1']);
    expect(live.products[0].focus).toEqual({ [PHOTO]: { x: 48, y: 18.13, zoom: 1.8 } });
  });

  it('forgets a point, so the shop guesses again', async () => {
    const cleared = await http
      .delete('/admin/products/FIG1/photo-focus')
      .query({ url: PHOTO })
      .set(asStaff)
      .expect(200);
    expect(cleared.body.focus).toEqual({});
    await http.delete('/admin/products/FIG1/photo-focus').set(asStaff).expect(400);
  });

  it('refuses a photo of another product, numbers out of range, and shoppers', async () => {
    await http
      .put('/admin/products/PRZ1/photo-focus')
      .set(asStaff)
      .send({ url: PHOTO, x: 10, y: 10, zoom: 1 })
      .expect(404);
    await http
      .put('/admin/products/FIG1/photo-focus')
      .set(asStaff)
      .send({ url: PHOTO, x: 120, y: 10, zoom: 1 })
      .expect(400);
    await http
      .put('/admin/products/FIG1/photo-focus')
      .set({ Authorization: shopper.auth })
      .send({ url: PHOTO, x: 10, y: 10, zoom: 1 })
      .expect(403);
  });
});
