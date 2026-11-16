import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(() => shop.close());
const { http, staff, shopper, pglite } = shop;
const asStaff = { Authorization: staff.auth };
const PHOTO = 'https://sq.example/rem-box.jpg';

await pglite.query(
  'insert into public.product_images (square_item_id, image_url, sort_order) values ($1, $2, 7)',
  ['FIG1', PHOTO],
);
const shopFrames = async () =>
  ((await http.get('/products').expect(200)).body.items as { id: string; frames: object }[]).find(
    (p) => p.id === 'FIG1',
  )!.frames;

describe('photo frames', () => {
  it('moves and zooms a photo inside its square, and the shop gets it with the product', async () => {
    expect(await shopFrames()).toEqual({});
    const saved = await http
      .put('/admin/products/FIG1/photo-frame')
      .set(asStaff)
      .send({ url: PHOTO, x: 50, y: 20.456, zoom: 1.5 })
      .expect(200);
    expect(saved.body.frames).toEqual({ [PHOTO]: { x: 50, y: 20.46, zoom: 1.5 } });
    expect(await shopFrames()).toEqual({ [PHOTO]: { x: 50, y: 20.46, zoom: 1.5 } });
  });

  it('forgets a photo put back in the middle at no zoom', async () => {
    await http
      .put('/admin/products/FIG1/photo-frame')
      .set(asStaff)
      .send({ url: PHOTO, x: 50, y: 50, zoom: 1 })
      .expect(200);
    expect(await shopFrames()).toEqual({});
    const rows = await pglite.query('select 1 from public.photo_frames');
    expect(rows.rows).toHaveLength(0);
  });

  it('refuses a photo of another product, numbers out of range, and shoppers', async () => {
    await http
      .put('/admin/products/PRZ1/photo-frame')
      .set(asStaff)
      .send({ url: PHOTO, x: 10, y: 10, zoom: 1 })
      .expect(404);
    for (const bad of [
      { x: -1, y: 50, zoom: 1 },
      { x: 50, y: 101, zoom: 1 },
      { x: 50, y: 50, zoom: 0.5 },
      { x: 50, y: 50, zoom: 5 },
      { x: 'left', y: 50, zoom: 1 },
    ])
      await http
        .put('/admin/products/FIG1/photo-frame')
        .set(asStaff)
        .send({ url: PHOTO, ...bad })
        .expect(400);
    await http
      .put('/admin/products/FIG1/photo-frame')
      .set({ Authorization: shopper.auth })
      .send({ url: PHOTO, x: 10, y: 10, zoom: 1 })
      .expect(403);
  });

  it("lists a product's frames for the admin", async () => {
    await http
      .put('/admin/products/FIG1/photo-frame')
      .set(asStaff)
      .send({ url: PHOTO, x: 30, y: 70, zoom: 2 })
      .expect(200);
    const listed = await http.get('/admin/products/FIG1/photo-frames').set(asStaff).expect(200);
    expect(listed.body.frames).toEqual({ [PHOTO]: { x: 30, y: 70, zoom: 2 } });
    await http
      .get('/admin/products/FIG1/photo-frames')
      .set({ Authorization: shopper.auth })
      .expect(403);
  });
});
