import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAddService } from '../../src/modules/admin/products/quick-add.service.js';
import { SquarePhotosService } from '../../src/modules/admin/products/square-photos.service.js';
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
const { http, owner, staff, shopper, pglite } = shop;
const asStaff = { Authorization: staff.auth };
const photos = shop.app.get(SquarePhotosService);
const quickAdd = shop.app.get(QuickAddService);

const solid = (width: number, height: number, rgb: [number, number, number]) =>
  sharp({ create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
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
/** How see-through a picture is at a point (0: fully transparent, 255: solid). */
const alphaAt = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
};

/** Uploads a plain-coloured background; resolves to the response once it has the status wanted. */
const addBackground = async (
  name: string,
  rgb: [number, number, number],
  size = 800,
  status = 200,
) => {
  const data = (await solid(size, size, rgb)).toString('base64');
  return http
    .post('/admin/photo-backgrounds')
    .set(asStaff)
    .send({ name, contentType: 'image/jpeg', data })
    .expect(status);
};

async function worker() {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label: 'Gaming PC' })).body
    .token as string;
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => vi.restoreAllMocks());

describe('the background library', () => {
  it('is for staff, and keeps backgrounds in our storage with one default', async () => {
    await http.get('/admin/photo-backgrounds').set({ Authorization: shopper.auth }).expect(403);
    const blue = (await addBackground('Blue studio', [30, 60, 200])).body.background;
    expect(blue).toMatchObject({ name: 'Blue studio', isDefault: false });
    expect(blue.imageUrl).toMatch(
      /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/product-images\/backgrounds\//,
    );
    const wood = (await addBackground('Wood', [140, 90, 40])).body.background;

    const listed = (
      await http
        .put('/admin/photo-backgrounds/default')
        .set(asStaff)
        .send({ id: wood.id })
        .expect(200)
    ).body.backgrounds;
    expect(listed.map((b: { name: string; isDefault: boolean }) => [b.name, b.isDefault])).toEqual([
      ['Wood', true],
      ['Blue studio', false],
    ]);
    // white again: no default
    await http.put('/admin/photo-backgrounds/default').set(asStaff).send({ id: null }).expect(200);
    expect(
      (await http.get('/admin/photo-backgrounds').set(asStaff)).body.backgrounds.every(
        (b: { isDefault: boolean }) => !b.isDefault,
      ),
    ).toBe(true);

    expect(
      (
        await http
          .patch(`/admin/photo-backgrounds/${wood.id}`)
          .set(asStaff)
          .send({ name: 'Oak table' })
          .expect(200)
      ).body.background.name,
    ).toBe('Oak table');
    await http.delete(`/admin/photo-backgrounds/${wood.id}`).set(asStaff).expect(200);
    await http.delete(`/admin/photo-backgrounds/${wood.id}`).set(asStaff).expect(404);
    await http.delete(`/admin/photo-backgrounds/${blue.id}`).set(asStaff).expect(200);
  });

  it('refuses a picture too small to sit behind a product photo, and things that are not pictures', async () => {
    expect((await addBackground('Tiny', [0, 0, 0], 200, 400)).body.error).toMatch(/too small/);
    await http
      .post('/admin/photo-backgrounds')
      .set(asStaff)
      .send({
        name: 'x',
        contentType: 'image/jpeg',
        data: Buffer.from('not a picture').toString('base64'),
      })
      .expect(400);
    await http
      .post('/admin/photo-backgrounds')
      .set(asStaff)
      .send({ name: 'x', contentType: 'image/gif', data: 'R0lGOD' })
      .expect(400);
  });
});

describe('a photo from the photo computer, on the shop background', () => {
  it('is saved to Square transparent, shown on the shop background, and the background changes for every product at once', async () => {
    const as = await worker();
    await pglite.query(
      "insert into public.catalog_products (square_item_id, name, source) values ('BG1', 'Rem Figure', 'square') on conflict do nothing",
    );
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_OLD', url: 'https://sq.example/old.jpg' }],
      hidden: [],
    });
    await http
      .post('/admin/photo-batches')
      .set(asStaff)
      .send({ productIds: ['BG1'] })
      .expect(200);
    const job = (
      await http
        .post('/gleamshelf/jobs/claim')
        .set(as)
        .send({ features: ['photo'] })
        .expect(200)
    ).body.job;

    // a "cut-out" with no transparent background is refused: a white photo must never be taken for one
    await http
      .post(`/gleamshelf/jobs/${job.id}/result`)
      .set(as)
      .field('details', '{}')
      .attach('photo', await solid(500, 500, [255, 255, 255]), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
      .attach(
        'cutout',
        await sharp(await solid(300, 300, [9, 9, 9]))
          .png()
          .toBuffer(),
        { filename: 'c.png', contentType: 'image/png' },
      )
      .expect(400);
    await http
      .post(`/gleamshelf/jobs/${job.id}/result`)
      .set(as)
      .field('details', '{}')
      .attach('photo', await solid(500, 500, [255, 255, 255]), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
      .attach('cutout', await cutoutPng(), { filename: 'c.png', contentType: 'image/png' })
      .expect(200);
    const batchId = (await http.get('/admin/photo-batches').set(asStaff)).body.batches[0].id;
    const ready = (await http.get(`/admin/photo-batches/${batchId}`).set(asStaff)).body.batch
      .jobs[0];
    expect(ready.cutout).toMatch(/\/imports\//);

    const add = vi
      .spyOn(photos, 'add')
      .mockResolvedValue({ created: 'IMG_CLEAR', shown: [], hidden: [] });
    await http
      .post(`/admin/photo-batches/photos/${job.id}/apply`)
      .set(asStaff)
      .send({})
      .expect(200);
    const [, item, sent, replaces] = add.mock.calls[0];
    expect([item, replaces]).toEqual(['BG1', 'IMG_OLD']);
    // Square gets the product alone: see-through in the corner, the product (its pixels unchanged) in the middle
    expect(await alphaAt(sent, 5, 5)).toBe(0);
    expect(await alphaAt(sent, 800, 800)).toBe(255);
    expect(near(await pixel(sent, 800, 800), [220, 20, 20])).toBe(true);
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_CLEAR', url: 'https://sq.example/c.png' }],
      hidden: [],
    });
    expect(
      (await http.get('/admin/products/BG1/photos').set(asStaff).expect(200)).body.cutouts,
    ).toEqual([{ imageId: 'IMG_CLEAR', cutoutUrl: ready.cutout, transparent: true }]);

    // the shop background is public (the website puts transparent photos on it); none means plain white
    const config = async () =>
      (await http.get('/checkout/config').expect(200)).body.productBackground;
    expect(await config()).toBeNull();
    const pumpkin = (await addBackground('Halloween', [230, 110, 20])).body.background;
    await http
      .put('/admin/photo-backgrounds/default')
      .set(asStaff)
      .send({ id: pumpkin.id })
      .expect(200);
    expect(await config()).toEqual({ id: pumpkin.id, url: pumpkin.imageUrl });

    // places that cannot show transparency (eBay, link previews) get it on the shop background, and the new one after a change
    const onBackground = async (q: string) =>
      (
        await http
          .get(`/product-photos/on-background?${q}`)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200)
      ).body as Buffer;
    expect(near(await pixel(await onBackground('image=IMG_CLEAR'), 5, 5), [230, 110, 20])).toBe(
      true,
    );
    const snow = (await addBackground('Winter', [200, 220, 250])).body.background;
    await http
      .put('/admin/photo-backgrounds/default')
      .set(asStaff)
      .send({ id: snow.id })
      .expect(200);
    const winter = await onBackground('image=IMG_CLEAR');
    expect(near(await pixel(winter, 5, 5), [200, 220, 250])).toBe(true);
    expect(near(await pixel(winter, 800, 800), [220, 20, 20])).toBe(true);
    // only the shop's own transparent photos
    await http.get('/product-photos/on-background?image=IMG_NOPE').expect(404);
    await http.get('/product-photos/on-background?src=https://elsewhere.example/x.png').expect(404);
    await http.get('/product-photos/on-background').expect(404);

    // the storefront is told which of a product's photos are transparent
    await seedProduct(pglite, {
      id: 'BG_SHOP',
      name: 'Ram Figure',
      category: 'Figures',
      priceCents: 3000,
      stock: 1,
    });
    await pglite.query(
      "insert into public.product_images (square_item_id, square_image_id, image_url, sort_order) values ('BG_SHOP', 'IMG_SHOP_1', 'https://sq.example/shop1.png', 0), ('BG_SHOP', 'IMG_SHOP_2', 'https://sq.example/shop2.jpg', 1)",
    );
    await pglite.query(
      "insert into public.product_cutouts (square_item_id, image_id, cutout_url, transparent) values ('BG_SHOP', 'IMG_SHOP_1', $1, true)",
      [ready.cutout],
    );
    const product = (await http.get('/square/catalog/BG_SHOP').expect(200)).body.item;
    expect(product.images).toEqual([
      'https://sq.example/shop1.png',
      'https://sq.example/shop2.jpg',
    ]);
    expect(product.cutouts).toEqual(['https://sq.example/shop1.png']);
    expect(
      near(
        await pixel(
          await onBackground(`src=${encodeURIComponent('https://sq.example/shop1.png')}`),
          5,
          5,
        ),
        [200, 220, 250],
      ),
    ).toBe(true);

    await http.put('/admin/photo-backgrounds/default').set(asStaff).send({ id: null }).expect(200);
    expect(near(await pixel(await onBackground('image=IMG_CLEAR'), 5, 5), [255, 255, 255])).toBe(
      true,
    );
  });

  it("uses the photo computer's white square when asked, and an older photo can be made transparent later", async () => {
    const as = await worker();
    await pglite.query(
      "insert into public.catalog_products (square_item_id, name, source) values ('BG2', 'Luffy Figure', 'square') on conflict do nothing",
    );
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_2', url: 'https://sq.example/2.jpg' }],
      hidden: [],
    });
    const add = vi
      .spyOn(photos, 'add')
      .mockResolvedValue({ created: 'IMG_WHITE2', shown: [], hidden: [] });
    await http
      .post('/admin/photo-batches')
      .set(asStaff)
      .send({ productIds: ['BG2'] })
      .expect(200);
    const job = (
      await http
        .post('/gleamshelf/jobs/claim')
        .set(as)
        .send({ features: ['photo'] })
        .expect(200)
    ).body.job;
    await http
      .post(`/gleamshelf/jobs/${job.id}/result`)
      .set(as)
      .field('details', '{}')
      .attach('photo', await solid(500, 500, [250, 250, 250]), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
      .attach('cutout', await cutoutPng(), { filename: 'c.png', contentType: 'image/png' })
      .expect(200);
    // null: the photo computer's own white square, untouched
    await http
      .post(`/admin/photo-batches/photos/${job.id}/apply`)
      .set(asStaff)
      .send({ backgroundId: null })
      .expect(200);
    expect(near(await pixel(add.mock.calls[0][2], 250, 250), [250, 250, 250])).toBe(true);
    const counts = async () =>
      (await http.get('/admin/photo-backgrounds').set(asStaff).expect(200)).body.photos;
    const before = await counts();
    expect(before.older).toBeGreaterThanOrEqual(1);

    // made transparent later: the cut-out takes the white square's place, which is deleted (it was made from the same cut-out)
    add.mockResolvedValue({ created: 'IMG_CLEAR2', shown: [], hidden: [] });
    const remove = vi.spyOn(photos, 'remove').mockResolvedValue({
      shown: [{ id: 'IMG_CLEAR2', url: 'https://sq.example/c2.png' }],
      hidden: [],
    });
    const changed = (
      await http.post('/admin/products/BG2/photos/IMG_WHITE2/transparent').set(asStaff).expect(200)
    ).body;
    expect(changed.created).toBe('IMG_CLEAR2');
    expect(add.mock.calls[1][3]).toBe('IMG_WHITE2');
    expect(await alphaAt(add.mock.calls[1][2], 5, 5)).toBe(0);
    expect(remove).toHaveBeenCalledWith(expect.any(String), 'BG2', 'IMG_WHITE2');
    expect(changed.cutouts).toEqual([
      { imageId: 'IMG_CLEAR2', cutoutUrl: expect.stringMatching(/\/imports\//), transparent: true },
    ]);
    expect((await counts()).older).toBe(before.older - 1);
    // a photo with no cut-out cannot be
    expect(
      (await http.post('/admin/products/BG2/photos/IMG_OTHER/transparent').set(asStaff).expect(409))
        .body.error,
    ).toMatch(/no cut-out/);

    // every older one at once
    await pglite.query(
      "insert into public.product_cutouts (square_item_id, image_id, cutout_url, transparent) values ('BG2', 'IMG_BAKED', (select cutout_url from public.product_cutouts where image_id = 'IMG_CLEAR2'), false)",
    );
    add.mockResolvedValue({ created: 'IMG_BAKED_CLEAR', shown: [], hidden: [] });
    const all = (
      await http.post('/admin/photo-backgrounds/make-transparent').set(asStaff).expect(200)
    ).body;
    expect(all).toMatchObject({ done: 1, failed: 0, older: 0 });
  });
});

describe('a draft from Gleamshelf, on the shop background', () => {
  it('adds the product with its cut-out transparent, and keeps an eBay copy as a cut-out', async () => {
    const as = await worker();
    const draft = {
      sourceKey: 'background-draft-1',
      title: 'Nami Figure (One Piece)',
      description: null,
      category: null,
      series: null,
      flags: [],
      sources: [],
      lookup: null,
      generator: 'gleamshelf 0.2.0',
    };
    const sent = await http
      .post('/gleamshelf/imports')
      .set(as)
      .field('draft', JSON.stringify(draft))
      .attach('photo', await solid(500, 500, [255, 255, 255]), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
      .attach('cutout', await cutoutPng(), { filename: 'c.png', contentType: 'image/png' })
      .expect(200);
    const got = (await http.get(`/admin/imports/${sent.body.id}`).set(asStaff)).body.draft;
    expect(got.cutoutUrl).toMatch(/\/imports\//);

    let firstPhoto: Buffer | null = null;
    vi.spyOn(quickAdd, 'add').mockImplementation(async (_admin, dto) => {
      firstPhoto = stored.get(dto.imageUrls[0].split('/public/product-images/')[1]) ?? null;
      return { id: 'SQ_BG', name: dto.name, photos: 1 };
    });
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_NAMI', url: 'https://sq.example/n.png' }],
      hidden: [],
    });
    await http
      .post(`/admin/imports/${sent.body.id}/add`)
      .set(asStaff)
      .send({
        name: 'Nami Figure (One Piece)',
        priceCents: 3000,
        stockCount: 1,
        hidden: true,
        photos: [{ key: 'background', square: true, ebay: true }],
      })
      .expect(200);
    expect(firstPhoto).not.toBeNull();
    expect(await alphaAt(firstPhoto!, 5, 5)).toBe(0);
    expect(near(await pixel(firstPhoto!, 800, 800), [220, 20, 20])).toBe(true);
    const kept = await pglite.query<{ square_item_id: string; transparent: boolean }>(
      "select square_item_id, transparent from public.product_cutouts where image_id = 'IMG_NAMI'",
    );
    expect(kept.rows).toEqual([{ square_item_id: 'SQ_BG', transparent: true }]);
    const ebay = await pglite.query<{ cutout: boolean; image_url: string }>(
      "select cutout, image_url from public.channel_photos where square_item_id = 'SQ_BG' and channel = 'ebay'",
    );
    expect(ebay.rows).toHaveLength(1);
    expect(ebay.rows[0].cutout).toBe(true);
    expect(
      await alphaAt(stored.get(ebay.rows[0].image_url.split('/public/product-images/')[1])!, 5, 5),
    ).toBe(0);
  });
});

describe('a draft added without Square (a local copy of the shop with no keys)', () => {
  it('becomes a product kept by the shop alone, its cut-out still transparent and on the shop background', async () => {
    const as = await worker();
    const sent = await http
      .post('/gleamshelf/imports')
      .set(as)
      .field(
        'draft',
        JSON.stringify({
          sourceKey: 'no-square-draft1',
          title: 'Robin Figure (One Piece)',
          description: null,
          category: null,
          series: null,
          flags: [],
          sources: [],
          lookup: null,
          generator: 'gleamshelf 0.2.0',
        }),
      )
      .attach('photo', await solid(500, 500, [255, 255, 255]), {
        filename: 'p.jpg',
        contentType: 'image/jpeg',
      })
      .attach('cutout', await cutoutPng(), { filename: 'c.png', contentType: 'image/png' })
      .expect(200);
    const token = process.env.SQUARE_ACCESS_TOKEN;
    process.env.SQUARE_ACCESS_TOKEN = '';
    const quick = vi.spyOn(quickAdd, 'add');
    try {
      const product = (
        await http
          .post(`/admin/imports/${sent.body.id}/add`)
          .set(asStaff)
          .send({
            name: 'Robin Figure (One Piece)',
            priceCents: 2500,
            stockCount: 1,
            photos: [{ key: 'background', square: true, ebay: false }],
          })
          .expect(200)
      ).body.product;
      expect(quick).not.toHaveBeenCalled();
      expect(product.id).toMatch(/^manual-/);
      const shown = (await http.get(`/square/catalog/${product.id}`).expect(200)).body.item;
      expect(shown.images).toHaveLength(1);
      expect(shown.cutouts).toEqual(shown.images);
      expect(
        await alphaAt(stored.get(shown.images[0].split('/public/product-images/')[1])!, 5, 5),
      ).toBe(0);
      const merged = (
        await http
          .get(`/product-photos/on-background?src=${encodeURIComponent(shown.images[0])}`)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          })
          .expect(200)
      ).body as Buffer;
      expect(near(await pixel(merged, 800, 800), [220, 20, 20])).toBe(true);
    } finally {
      process.env.SQUARE_ACCESS_TOKEN = token;
    }
  });
});
