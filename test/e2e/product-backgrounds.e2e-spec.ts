import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch, seedProduct } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
/** Our photo storage (Supabase) stands in, keeping what is uploaded so it can be read back, as the real one does. */
const stored = new Map<string, Buffer>();
const storage = mockFetch({
  'https://proj.supabase.co/storage/v1/object/public/product-images/': (_init, url) => {
    const bytes = stored.get(url.split('/public/product-images/')[1]);
    return bytes
      ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/png' } })
      : new Response('missing', { status: 404 });
  },
  'https://proj.supabase.co/storage/v1/object/product-images': (init, url) => {
    if (init?.method === 'POST')
      stored.set(url.split('/object/product-images/')[1], Buffer.from(init.body as Uint8Array));
    return [];
  },
});
afterAll(() => {
  storage.restore();
  return shop.close();
});
const { http, staff, shopper, pglite } = shop;
const asStaff = { Authorization: staff.auth };

const solid = (size: number, rgb: [number, number, number]) =>
  sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .jpeg()
    .toBuffer();
/** A red square in the middle of a transparent picture: the product alone, as Gleamshelf sends it. */
const cutoutPng = () =>
  sharp({
    create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: 200,
            height: 200,
            channels: 4,
            background: { r: 220, g: 20, b: 20, alpha: 1 },
          },
        },
        left: 100,
        top: 100,
      },
    ])
    .png()
    .toBuffer();
const pixel = async (jpeg: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};
const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) < 24);
const own = async () =>
  (await http.get('/product-photos/backgrounds').expect(200)).body.items as Record<
    string,
    string | null
  >;
const boxArt = async (itemId: string, rgb: [number, number, number], size = 800, status = 200) =>
  http
    .put(`/admin/products/${itemId}/box-art`)
    .set(asStaff)
    .send({ contentType: 'image/jpeg', data: (await solid(size, rgb)).toString('base64') })
    .expect(status);

describe("a product's own background", () => {
  it('can be white, a library background or its box art, for one product or all, and changed back', async () => {
    stored.set('cutouts/ram.png', await cutoutPng());
    const cutout =
      'https://proj.supabase.co/storage/v1/object/public/product-images/cutouts/ram.png';
    for (const [id, name] of [
      ['PB_RAM', 'Ram Figure'],
      ['PB_REM', 'Rem Figure'],
    ])
      await seedProduct(pglite, { id, name, category: 'Figures', priceCents: 3000, stock: 1 });
    await pglite.query(
      "insert into public.product_images (square_item_id, square_image_id, image_url, sort_order) values ('PB_RAM', 'PB_IMG_1', 'https://sq.example/ram-figure.png', 0), ('PB_RAM', 'PB_IMG_2', 'https://sq.example/ram-box.jpg', 1)",
    );
    await pglite.query(
      "insert into public.product_cutouts (square_item_id, image_id, cutout_url, transparent) values ('PB_RAM', 'PB_IMG_1', $1, true)",
      [cutout],
    );

    // nothing of its own to start with: every product shows on the shop background
    expect(await own()).toEqual({});
    await http.get('/admin/product-backgrounds').set({ Authorization: shopper.auth }).expect(403);
    expect(
      (await http.get('/admin/product-backgrounds').set(asStaff).expect(200)).body,
    ).toMatchObject({
      rule: 'shop',
      products: { transparent: 1, withBoxArt: 0, withOwnChoice: 0 },
    });
    // the product with a transparent photo and a photo of its box can have box art made
    expect(
      (await http.get('/admin/product-backgrounds/box-art-candidates').set(asStaff).expect(200))
        .body.items,
    ).toEqual([
      { itemId: 'PB_RAM', name: 'Ram Figure', photoUrl: 'https://sq.example/ram-box.jpg' },
    ]);

    // one product on plain white
    const white = (
      await http
        .put('/admin/products/PB_RAM/background')
        .set(asStaff)
        .send({ mode: 'white' })
        .expect(200)
    ).body.background;
    expect(white).toMatchObject({ mode: 'white', shows: { own: true, url: null } });
    expect(await own()).toEqual({ PB_RAM: null });
    // the copy made for eBay and link previews is on the product's own background, not the shop's
    const photo = (await http.get('/product-photos/on-background?image=PB_IMG_1').expect(200))
      .body as Buffer;
    expect(near(await pixel(photo, 5, 5), [255, 255, 255])).toBe(true);

    // box art: none yet, too small, then kept
    await http
      .put('/admin/products/PB_RAM/background')
      .set(asStaff)
      .send({ mode: 'box_art' })
      .expect(409);
    await boxArt('PB_RAM', [40, 90, 160], 200, 400);
    await boxArt('PB_NOPE', [40, 90, 160], 800, 404);
    const art = (await boxArt('PB_RAM', [40, 90, 160])).body.background.boxArtUrl as string;
    expect(art).toMatch(/\/product-images\/backgrounds\//);
    expect(await own()).toEqual({ PB_RAM: null }); // still white: having box art does not choose it
    expect(
      (await http.get('/admin/product-backgrounds/box-art-candidates').set(asStaff)).body.items,
    ).toEqual([]);

    // every product to box art, where there is one: Ram has it, the others keep what they had
    const many = (
      await http
        .post('/admin/product-backgrounds/many')
        .set(asStaff)
        .send({ mode: 'box_art' })
        .expect(200)
    ).body;
    expect(many.changed).toBe(1);
    expect(many.skipped).toBeGreaterThanOrEqual(1);
    expect(await own()).toEqual({ PB_RAM: art });
    const onArt = (await http.get('/product-photos/on-background?image=PB_IMG_1').expect(200))
      .body as Buffer;
    expect(near(await pixel(onArt, 5, 5), [40, 90, 160])).toBe(true);

    // and back: no product has a choice of its own, so the rule decides
    expect(
      (
        await http
          .post('/admin/product-backgrounds/many')
          .set(asStaff)
          .send({ mode: null })
          .expect(200)
      ).body.changed,
    ).toBe(1);
    expect(await own()).toEqual({});
    await http
      .put('/admin/product-backgrounds/rule')
      .set(asStaff)
      .send({ rule: 'everything' })
      .expect(400);
    await http
      .put('/admin/product-backgrounds/rule')
      .set(asStaff)
      .send({ rule: 'box_art' })
      .expect(200);
    expect(await own()).toEqual({ PB_RAM: art });
    // a product's own choice wins over the rule
    await http
      .put('/admin/products/PB_RAM/background')
      .set(asStaff)
      .send({ mode: 'shop' })
      .expect(200);
    expect(await own()).toEqual({});
    await http
      .put('/admin/product-backgrounds/rule')
      .set(asStaff)
      .send({ rule: 'shop' })
      .expect(200);

    // a background of the library, for the products named; deleting it from the library gives them the shop background again
    const wood = (
      await http
        .post('/admin/photo-backgrounds')
        .set(asStaff)
        .send({
          name: 'Wood',
          contentType: 'image/jpeg',
          data: (await solid(800, [120, 80, 40])).toString('base64'),
        })
        .expect(200)
    ).body.background;
    await http
      .put('/admin/products/PB_REM/background')
      .set(asStaff)
      .send({ mode: 'library' })
      .expect(400);
    const named = (
      await http
        .post('/admin/product-backgrounds/many')
        .set(asStaff)
        .send({ mode: 'library', backgroundId: wood.id, itemIds: ['PB_REM'] })
        .expect(200)
    ).body;
    expect(named.changed).toBe(1);
    expect(await own()).toEqual({ PB_REM: wood.imageUrl });
    await http.delete(`/admin/photo-backgrounds/${wood.id}`).set(asStaff).expect(200);
    expect(await own()).toEqual({});

    // deleting the box art
    await http
      .put('/admin/products/PB_RAM/background')
      .set(asStaff)
      .send({ mode: 'box_art' })
      .expect(200);
    expect(await own()).toEqual({ PB_RAM: art });
    await http.delete('/admin/products/PB_RAM/box-art').set(asStaff).expect(200);
    expect(await own()).toEqual({});
    await http.delete('/admin/products/PB_RAM/box-art').set(asStaff).expect(404);
  });
});
