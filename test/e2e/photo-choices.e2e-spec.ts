import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAddService } from '../../src/modules/admin/products/quick-add.service.js';
import { SquarePhotosService } from '../../src/modules/admin/products/square-photos.service.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
/** Our photo storage (Supabase) stands in, keeping what is uploaded so it can be read back. */
const stored = new Map<string, Buffer>();
const storage = mockFetch({
  'https://proj.supabase.co/storage/v1/object/public/product-images/': (_init, url) => {
    const bytes = stored.get(url.split('/public/product-images/')[1]);
    return bytes
      ? new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } })
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
const { http, owner, staff, pglite } = shop;
const asStaff = { Authorization: staff.auth };
const photos = shop.app.get(SquarePhotosService);
const quickAdd = shop.app.get(QuickAddService);
const read = (url: string) => stored.get(url.split('/public/product-images/')[1])!;

/** A photo as taken: a green backdrop with a blue box in it, from x 300 to 500 and y 100 to 500 of 800 x 600. */
const photo = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 160, b: 60 } } })
    .composite([
      {
        input: {
          create: { width: 200, height: 400, channels: 3, background: { r: 40, g: 60, b: 200 } },
        },
        left: 300,
        top: 100,
      },
    ])
    .jpeg()
    .toBuffer();
const studio = () =>
  sharp({ create: { width: 500, height: 500, channels: 3, background: '#ffffff' } })
    .jpeg()
    .toBuffer();
const cutout = () =>
  sharp({
    create: { width: 200, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: {
          create: {
            width: 100,
            height: 300,
            channels: 4,
            background: { r: 40, g: 60, b: 200, alpha: 1 },
          },
        },
        left: 50,
        top: 50,
      },
    ])
    .png()
    .toBuffer();

async function worker() {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label: 'Choices PC' })).body
    .token as string;
  return { Authorization: `Bearer ${token}` };
}

/** Uploads a photo in the admin, lets the photo computer finish it, and returns the draft. */
async function draftFromUpload(
  name: string,
  productRect: unknown = { x: 0.375, y: 1 / 6, width: 0.25, height: 2 / 3 },
) {
  const as = await worker();
  await http
    .post('/admin/listing-jobs')
    .set(asStaff)
    .attach('photos', await photo(), { filename: name, contentType: 'image/jpeg' })
    .expect(200);
  let job = (
    await http
      .post('/gleamshelf/listing-jobs/claim')
      .set(as)
      .send({ features: ['photo', 'listing'] })
      .expect(200)
  ).body.job;
  while (job && job.fileName !== name)
    job = (
      await http
        .post('/gleamshelf/listing-jobs/claim')
        .set(as)
        .send({ features: ['photo', 'listing'] })
    ).body.job;
  const draft = {
    sourceKey: `choices-${name}`.replace(/[^a-z0-9-]/gi, '-'),
    title: 'Sheryl Nome Figure (Macross Frontier)',
    description: null,
    category: null,
    series: null,
    flags: [],
    sources: [],
    lookup: null,
    generator: 'gleamshelf 0.2.0',
  };
  const r = await http
    .post(`/gleamshelf/listing-jobs/${job.id}/result`)
    .set(as)
    .field('draft', JSON.stringify(draft))
    .field('details', JSON.stringify({ flags: [], seconds: 9, productRect }))
    .attach('photo', await studio(), { filename: 'p.jpg', contentType: 'image/jpeg' })
    .attach('cutout', await cutout(), { filename: 'c.png', contentType: 'image/png' })
    .expect(200);
  return (await http.get(`/admin/imports/${r.body.draftId}`).set(asStaff).expect(200)).body
    .draft as {
    id: string;
    photos: { key: string; url: string }[];
  };
}

beforeEach(() => vi.restoreAllMocks());

describe('the photos a draft offers', () => {
  it('keeps the photo as taken and adds it cropped to the product (no AI), next to the studio photo and the cut-out', async () => {
    const d = await draftFromUpload('choices-1.jpg');
    expect(d.photos.map((p) => p.key)).toEqual(['studio', 'background', 'cropped', 'original']);
    const crop = await sharp(read(d.photos.find((p) => p.key === 'cropped')!.url)).metadata();
    // the box (200 x 400) with 4% of its size around it
    expect(Math.abs(crop.width - 216)).toBeLessThanOrEqual(1);
    expect(Math.abs(crop.height - 432)).toBeLessThanOrEqual(1);
    const original = await sharp(read(d.photos.find((p) => p.key === 'original')!.url)).metadata();
    expect([original.width, original.height]).toEqual([800, 600]);
  });

  it('offers no crop when the photo computer did not say where the product is', async () => {
    const d = await draftFromUpload('choices-2.jpg', null);
    expect(d.photos.map((p) => p.key)).toEqual(['studio', 'background', 'original']);
  });
});

describe("the maker's other photos", () => {
  it("offers each as its own choice, only from makers' sites", async () => {
    const as = await worker();
    const draft = {
      sourceKey: 'choices-official-more',
      title: 'Rem Figure',
      description: null,
      category: null,
      series: null,
      flags: [],
      sources: [],
      lookup: null,
      generator: 'gleamshelf 0.2.0',
      official: {
        imageUrl: 'https://assets.1kuji.com/up/rem_01.jpg',
        pageUrl: 'https://1kuji.com/products/re-zero14',
        more: [
          'https://assets.1kuji.com/up/rem_02.jpg',
          'https://evil.example/x.jpg',
          'https://assets.1kuji.com/up/rem_03.jpg',
        ],
      },
    };
    const r = await http
      .post('/gleamshelf/imports')
      .set(as)
      .field('draft', JSON.stringify(draft))
      .attach('photo', await studio(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(200);
    const d = (await http.get(`/admin/imports/${r.body.id}`).set(asStaff).expect(200)).body.draft;
    expect(d.photos.map((p: { key: string; url: string }) => [p.key, p.url])).toEqual([
      ['studio', expect.any(String)],
      ['official', 'https://assets.1kuji.com/up/rem_01.jpg'],
      ['official2', 'https://assets.1kuji.com/up/rem_02.jpg'],
      ['official3', 'https://assets.1kuji.com/up/rem_03.jpg'],
    ]);
  });
});

describe('choosing which photos go where', () => {
  it('sends the ones for Square in order, keeps eBay copies of the ones for eBay, and keeps the cut-out behind its Square photo', async () => {
    const d = await draftFromUpload('choices-3.jpg');
    let sent: string[] = [];
    vi.spyOn(quickAdd, 'add').mockImplementation(async (_a, dto) => {
      sent = dto.imageUrls;
      return { id: 'SQ_CHOICE', name: dto.name, photos: dto.imageUrls.length };
    });
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [
        { id: 'IMG_CROP', url: 'https://sq.example/1.jpg' },
        { id: 'IMG_STUDIO', url: 'https://sq.example/2.jpg' },
      ],
      hidden: [],
    });
    await http
      .post(`/admin/imports/${d.id}/add`)
      .set(asStaff)
      .send({
        name: 'Sheryl Nome Figure',
        priceCents: 4000,
        stockCount: 1,
        hidden: true,
        photos: [
          { key: 'cropped', square: true, ebay: true },
          { key: 'studio', square: true },
          { key: 'original', ebay: true },
        ],
      })
      .expect(200);
    const url = (k: string) => d.photos.find((p) => p.key === k)!.url;
    expect(sent).toEqual([url('cropped'), url('studio')]);
    const ebay = (
      await pglite.query<{ image_url: string; position: number }>(
        "select image_url, position from public.channel_photos where square_item_id = 'SQ_CHOICE' and channel = 'ebay' order by position",
      )
    ).rows;
    expect(ebay).toHaveLength(2);
    expect(ebay.every((r) => r.image_url.includes('/channels/'))).toBe(true);
    // the eBay copy of the photo as taken is the whole photo
    expect((await sharp(read(ebay[1].image_url)).metadata()).width).toBe(800);
    const kept = (
      await pglite.query<{ image_id: string; background_id: string | null }>(
        "select image_id, background_id from public.product_cutouts where square_item_id = 'SQ_CHOICE'",
      )
    ).rows;
    expect(kept).toEqual([{ image_id: 'IMG_STUDIO', background_id: null }]);
  });

  it('refuses a photo the draft does not have, and a choice of nothing', async () => {
    const d = await draftFromUpload('choices-4.jpg', null);
    const body = { name: 'X', priceCents: 1000, stockCount: 1, hidden: true };
    expect(
      (
        await http
          .post(`/admin/imports/${d.id}/add`)
          .set(asStaff)
          .send({ ...body, photos: [{ key: 'cropped', square: true }] })
          .expect(409)
      ).body.error,
    ).toMatch(/no "cropped" photo/);
    await http
      .post(`/admin/imports/${d.id}/add`)
      .set(asStaff)
      .send({ ...body, photos: [{ key: 'studio' }] })
      .expect(400);
    await http
      .post(`/admin/imports/${d.id}/add`)
      .set(asStaff)
      .send({ ...body, photos: [{ key: 'nonsense', square: true }] })
      .expect(400);
  });
});

describe('editing a draft photo before it is used', () => {
  it('keeps the edit (the photo as offered stays, so it can be undone), and sends the edit to Square', async () => {
    const d = await draftFromUpload('choices-edit.jpg');
    // the editor reads the photo through the server
    const file = await http
      .get(`/admin/imports/${d.id}/photos/cropped/file`)
      .set(asStaff)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((await sharp(file.body as Buffer).metadata()).width).toBeGreaterThan(200);
    await http.get(`/admin/imports/${d.id}/photos/background/file`).set(asStaff).expect(404);

    const edit = await sharp({
      create: { width: 300, height: 300, channels: 3, background: { r: 250, g: 10, b: 10 } },
    })
      .webp()
      .toBuffer();
    const edited = (
      await http
        .put(`/admin/imports/${d.id}/photos/cropped`)
        .set(asStaff)
        .send({ contentType: 'image/webp', data: edit.toString('base64') })
        .expect(200)
    ).body.draft;
    const cropped = edited.photos.find((p: { key: string }) => p.key === 'cropped');
    expect(cropped.edited).toBe(true);
    expect(cropped.url).not.toBe(d.photos.find((p) => p.key === 'cropped')!.url);

    // undo, then edit again
    const undone = (
      await http.delete(`/admin/imports/${d.id}/photos/cropped/edit`).set(asStaff).expect(200)
    ).body.draft;
    expect(undone.photos.find((p: { key: string }) => p.key === 'cropped')).toMatchObject({
      edited: false,
      url: d.photos.find((p) => p.key === 'cropped')!.url,
    });
    const again = (
      await http
        .put(`/admin/imports/${d.id}/photos/cropped`)
        .set(asStaff)
        .send({ contentType: 'image/webp', data: edit.toString('base64') })
        .expect(200)
    ).body.draft;
    const editedUrl = again.photos.find((p: { key: string }) => p.key === 'cropped').url as string;

    let sentUrls: string[] = [];
    vi.spyOn(quickAdd, 'add').mockImplementation(async (_a, dto) => {
      sentUrls = dto.imageUrls;
      return { id: 'SQ_EDITED', name: dto.name, photos: 1 };
    });
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [{ id: 'IMG_E', url: 'https://sq.example/e.jpg' }],
      hidden: [],
    });
    await http
      .post(`/admin/imports/${d.id}/add`)
      .set(asStaff)
      .send({
        name: 'Edited',
        priceCents: 1000,
        stockCount: 1,
        hidden: true,
        photos: [{ key: 'cropped', square: true }],
      })
      .expect(200);
    expect(sentUrls).toEqual([editedUrl]);
  });
});

describe("a product's eBay photos (eBay not connected yet)", () => {
  it("keeps the photos picked for eBay, in order, only from the product's own photos", async () => {
    await pglite.query(
      "insert into public.catalog_products (square_item_id, name, source) values ('SQ_EBAY', 'Rem Figure', 'square') on conflict do nothing",
    );
    vi.spyOn(photos, 'list').mockResolvedValue({
      shown: [
        { id: 'A', url: 'https://sq.example/a.jpg' },
        { id: 'B', url: 'https://sq.example/b.jpg' },
      ],
      hidden: [],
    });
    expect(
      (await http.get('/admin/products/SQ_EBAY/photos').set(asStaff).expect(200)).body.ebay,
    ).toEqual([]);
    const r = await http
      .put('/admin/products/SQ_EBAY/channel-photos/ebay')
      .set(asStaff)
      .send({ urls: ['https://sq.example/b.jpg', 'https://sq.example/a.jpg'] })
      .expect(200);
    expect(r.body.ebay).toEqual(['https://sq.example/b.jpg', 'https://sq.example/a.jpg']);
    expect((await http.get('/admin/products/SQ_EBAY/photos').set(asStaff)).body.ebay).toEqual([
      'https://sq.example/b.jpg',
      'https://sq.example/a.jpg',
    ]);
    await http
      .put('/admin/products/SQ_EBAY/channel-photos/ebay')
      .set(asStaff)
      .send({ urls: ['https://elsewhere.example/x.jpg'] })
      .expect(400);
  });
});
