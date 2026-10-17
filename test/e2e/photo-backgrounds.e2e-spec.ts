import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAddService } from '../../src/modules/admin/products/quick-add.service.js';
import { SquarePhotosService } from '../../src/modules/admin/products/square-photos.service.js';
import { mockFetch } from '../support/harness.js';
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

describe('a photo from the photo computer, on a background', () => {
  it('puts the cut-out on the chosen background, keeps it with the product, and changes the background later', async () => {
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

    const green = (await addBackground('Green', [20, 160, 60])).body.background;
    const add = vi
      .spyOn(photos, 'add')
      .mockResolvedValue({ created: 'IMG_GREEN', shown: [], hidden: [] });
    await http
      .post(`/admin/photo-batches/photos/${job.id}/apply`)
      .set(asStaff)
      .send({ backgroundId: green.id })
      .expect(200);
    expect(add).toHaveBeenCalledOnce();
    const [, item, sent, replaces] = add.mock.calls[0];
    expect([item, replaces]).toEqual(['BG1', 'IMG_OLD']);
    // the corner is the background, the middle is the product (its pixels unchanged)
    expect(near(await pixel(sent, 5, 5), [20, 160, 60])).toBe(true);
    expect(near(await pixel(sent, 800, 800), [220, 20, 20])).toBe(true);

    // the cut-out stays with the product, behind the new photo
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_GREEN', url: 'https://sq.example/g.jpg' }],
      hidden: [],
    });
    const listed = (await http.get('/admin/products/BG1/photos').set(asStaff).expect(200)).body;
    expect(listed.cutouts).toEqual([
      { imageId: 'IMG_GREEN', cutoutUrl: ready.cutout, backgroundId: green.id },
    ]);

    // later: white instead; the photo made here from the cut-out is replaced and deleted, not kept hidden
    add.mockResolvedValue({ created: 'IMG_WHITE', shown: [], hidden: [] });
    const remove = vi.spyOn(photos, 'remove').mockResolvedValue({
      shown: [{ id: 'IMG_WHITE', url: 'https://sq.example/w.jpg' }],
      hidden: [],
    });
    const changed = (
      await http
        .put('/admin/products/BG1/photos/IMG_GREEN/background')
        .set(asStaff)
        .send({ backgroundId: null })
        .expect(200)
    ).body;
    expect(changed.created).toBe('IMG_WHITE');
    expect(add.mock.calls[1][3]).toBe('IMG_GREEN');
    expect(near(await pixel(add.mock.calls[1][2], 5, 5), [255, 255, 255])).toBe(true);
    expect(remove).toHaveBeenCalledWith(expect.any(String), 'BG1', 'IMG_GREEN');
    expect(changed.cutouts).toEqual([
      { imageId: 'IMG_WHITE', cutoutUrl: ready.cutout, backgroundId: null },
    ]);

    // a photo with no cut-out cannot be changed
    expect(
      (
        await http
          .put('/admin/products/BG1/photos/IMG_OTHER/background')
          .set(asStaff)
          .send({ backgroundId: green.id })
          .expect(409)
      ).body.error,
    ).toMatch(/no cut-out/);
    // nor put on a background that is no longer in the library
    await http.delete(`/admin/photo-backgrounds/${green.id}`).set(asStaff).expect(200);
    await http
      .put('/admin/products/BG1/photos/IMG_WHITE/background')
      .set(asStaff)
      .send({ backgroundId: green.id })
      .expect(404);
  });

  it("uses the default background when none is chosen, and the photo computer's white photo when the shop has none", async () => {
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
      .mockResolvedValue({ created: 'IMG_NEW2', shown: [], hidden: [] });
    const submitOne = async () => {
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
      return job.id as string;
    };
    // no default: the photo computer's own white square, untouched
    const first = await submitOne();
    await http.post(`/admin/photo-batches/photos/${first}/apply`).set(asStaff).expect(200);
    expect(near(await pixel(add.mock.calls[0][2], 250, 250), [250, 250, 250])).toBe(true);
    // with a default: on it
    await pglite.query(
      "update public.product_cutouts set image_id = 'IMG_DONE' where image_id = 'IMG_NEW2'",
    );
    const purple = (await addBackground('Purple', [120, 40, 160])).body.background;
    await http
      .put('/admin/photo-backgrounds/default')
      .set(asStaff)
      .send({ id: purple.id })
      .expect(200);
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_NEW2', url: 'https://sq.example/2.jpg' }],
      hidden: [],
    });
    const second = await submitOne();
    await http
      .post(`/admin/photo-batches/photos/${second}/apply`)
      .set(asStaff)
      .send({})
      .expect(200);
    expect(near(await pixel(add.mock.calls[1][2], 5, 5), [120, 40, 160])).toBe(true);
    await http.put('/admin/photo-backgrounds/default').set(asStaff).send({ id: null }).expect(200);
  });
});

describe('a draft from Gleamshelf, on a background', () => {
  it('adds the product with its own photo on the chosen background, and keeps the cut-out behind it', async () => {
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

    const sand = (await addBackground('Sand', [210, 190, 140])).body.background;
    let firstPhoto: Buffer | null = null;
    vi.spyOn(quickAdd, 'add').mockImplementation(async (_admin, dto) => {
      firstPhoto = stored.get(dto.imageUrls[0].split('/public/product-images/')[1]) ?? null;
      return { id: 'SQ_BG', name: dto.name, photos: 1 };
    });
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_SAND', url: 'https://sq.example/s.jpg' }],
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
        backgroundId: sand.id,
      })
      .expect(200);
    expect(firstPhoto).not.toBeNull();
    expect(near(await pixel(firstPhoto!, 5, 5), [210, 190, 140])).toBe(true);
    expect(near(await pixel(firstPhoto!, 800, 800), [220, 20, 20])).toBe(true);
    const kept = await pglite.query<{ square_item_id: string; background_id: string }>(
      "select square_item_id, background_id from public.product_cutouts where image_id = 'IMG_SAND'",
    );
    expect(kept.rows).toEqual([{ square_item_id: 'SQ_BG', background_id: sand.id }]);
  });
});
