import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SquareCatalogClient } from '../../src/integrations/square/square-catalog.client.js';
import { SquareSyncService } from '../../src/modules/square-sync/square-sync.service.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;
const square = shop.app.get(SquareCatalogClient);
const sync = shop.app.get(SquareSyncService);
const as = { Authorization: staff.auth };
const url = (id: string) =>
  `https://items-images-sandbox.s3.us-west-2.amazonaws.com/files/${id}.jpg`;

/** A tiny stand-in for Square's photo list of one product, so the whole flow can be followed. */
const fake = {
  shown: ['A', 'B', 'C'],
  all: new Set(['A', 'B', 'C']),
  deleted: [] as string[],
  nextId: 1,
  created: [] as unknown[],
};
const spies = [
  vi.spyOn(square, 'readImageIds').mockImplementation(async () => [...fake.shown]),
  vi
    .spyOn(square, 'imageUrls')
    .mockImplementation(async (ids) =>
      Object.fromEntries(ids.filter((id) => fake.all.has(id)).map((id) => [id, url(id)])),
    ),
  vi.spyOn(square, 'setItemImageIds').mockImplementation(async (_item, ids) => {
    fake.shown = [...ids];
  }),
  vi.spyOn(square, 'createImage').mockImplementation(async (_item, _name, photo) => {
    const id = `NEW${fake.nextId++}`;
    fake.all.add(id);
    fake.created.push(photo.contentType);
    return id;
  }),
  vi.spyOn(square, 'deleteImages').mockImplementation(async (ids) => {
    for (const id of ids) {
      fake.all.delete(id);
      fake.deleted.push(id);
    }
  }),
  vi.spyOn(sync, 'syncItems').mockResolvedValue({ products: 1, variations: 1 }),
];
afterAll(() => spies.forEach((s) => s.mockRestore()));

const photos = async () => (await http.get('/admin/products/PRZ1/photos').set(as).expect(200)).body;
const ids = (list: { id: string }[]) => list.map((p) => p.id);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
).toString('base64');

describe('Square product photos', () => {
  beforeAll(() => {
    fake.shown = ['A', 'B', 'C'];
  });

  it('lists shown photos in order, and none hidden to begin with', async () => {
    const res = await photos();
    expect(ids(res.shown)).toEqual(['A', 'B', 'C']);
    expect(res.shown[0].url).toBe(url('A'));
    expect(res.hidden).toEqual([]);
  });

  it('hides a photo without deleting it, and shows it again where the admin puts it', async () => {
    const hid = await http
      .put('/admin/products/PRZ1/photos')
      .set(as)
      .send({ ids: ['A', 'C'] })
      .expect(200);
    expect(ids(hid.body.shown)).toEqual(['A', 'C']);
    expect(ids(hid.body.hidden)).toEqual(['B']);
    expect(fake.deleted).toEqual([]); // nothing was deleted
    expect(fake.all.has('B')).toBe(true);

    const back = await http
      .put('/admin/products/PRZ1/photos')
      .set(as)
      .send({ ids: ['B', 'A', 'C'] })
      .expect(200);
    expect(ids(back.body.shown)).toEqual(['B', 'A', 'C']); // B is the main photo now
    expect(back.body.hidden).toEqual([]);
  });

  it('saves an edit as a NEW photo in the same place and hides the original instead of deleting it', async () => {
    const res = await http
      .post('/admin/products/PRZ1/photos')
      .set(as)
      .send({ contentType: 'image/png', data: png, replaces: 'A' })
      .expect(200);
    expect(res.body.created).toBe('NEW1');
    expect(ids(res.body.shown)).toEqual(['B', 'NEW1', 'C']); // the edit took A's place
    expect(ids(res.body.hidden)).toEqual(['A']); // the original is kept, hidden
    expect(fake.deleted).toEqual([]);
  });

  it('adds a plain new photo at the end', async () => {
    const res = await http
      .post('/admin/products/PRZ1/photos')
      .set(as)
      .send({ contentType: 'image/png', data: png })
      .expect(200);
    expect(ids(res.body.shown)).toEqual(['B', 'NEW1', 'C', 'NEW2']);
  });

  it('deletes a photo only when asked, and takes it off the product first', async () => {
    const res = await http.delete('/admin/products/PRZ1/photos/A').set(as).expect(200);
    expect(fake.deleted).toEqual(['A']);
    expect(res.body.hidden).toEqual([]);
    const shownDelete = await http.delete('/admin/products/PRZ1/photos/C').set(as).expect(200);
    expect(ids(shownDelete.body.shown)).toEqual(['B', 'NEW1', 'NEW2']);
    expect(fake.deleted).toEqual(['A', 'C']);
  });

  it('refuses photos that are not this product’s, too many shown photos, and unknown products', async () => {
    await http
      .put('/admin/products/PRZ1/photos')
      .set(as)
      .send({ ids: ['ZZZ'] })
      .expect(400);
    await http
      .put('/admin/products/PRZ1/photos')
      .set(as)
      .send({ ids: ['B', 'B'] })
      .expect(400);
    await http.delete('/admin/products/PRZ1/photos/ZZZ').set(as).expect(404);
    await http.get('/admin/products/NOPE/photos').set(as).expect(404);
    await http
      .post('/admin/products/PRZ1/photos')
      .set(as)
      .send({ contentType: 'image/png', data: png, replaces: 'GONE' })
      .expect(400);
  });

  it('checks who is asking', async () => {
    await http.get('/admin/products/PRZ1/photos').expect(401);
    await http
      .put('/admin/products/PRZ1/photos')
      .set({ Authorization: shopper.auth })
      .send({ ids: [] })
      .expect(403);
  });
});

describe('opening a Square photo in the editor', () => {
  it('passes a Square-hosted photo through, and refuses any other address', async () => {
    const net = mockFetch({
      'items-images-sandbox.s3': () =>
        new Response(Buffer.from('jpegbytes'), { headers: { 'content-type': 'image/jpeg' } }),
    });
    try {
      const ok = await http
        .get(`/admin/photo-proxy?url=${encodeURIComponent(url('A'))}`)
        .set(as)
        .expect(200);
      expect(ok.headers['content-type']).toContain('image/jpeg');
      await http
        .get(`/admin/photo-proxy?url=${encodeURIComponent('https://evil.example/a.jpg')}`)
        .set(as)
        .expect(400);
      await http
        .get(`/admin/photo-proxy?url=${encodeURIComponent('http://localhost:8080/health')}`)
        .set(as)
        .expect(400);
      await http.get('/admin/photo-proxy').set(as).expect(400);
    } finally {
      net.restore();
    }
  });
});
