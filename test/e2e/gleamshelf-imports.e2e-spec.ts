import { afterAll, describe, expect, it, vi } from 'vitest';
import { QuickAddService } from '../../src/modules/admin/products/quick-add.service.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
/** Our photo storage (Supabase) stands in; the draft routes talk to nothing else. */
const storage = mockFetch({
  'https://proj.supabase.co/storage/v1/object/product-images': () => [],
});
afterAll(() => {
  storage.restore();
  return shop.close();
});
const { http, owner, staff, shopper } = shop;
const quickAdd = shop.app.get(QuickAddService);

/** A tiny JPEG-typed upload; the storage is local in tests (no network). */
const PHOTO = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);
const draft = (over: Record<string, unknown> = {}) => ({
  sourceKey: 'a1b2c3d4e5f6a7b8',
  title: 'Yukihana Lamy Figure (hololive)',
  description: 'A prize figure of Yukihana Lamy.',
  category: 'Bishoujo Figures',
  series: 'hololive',
  flags: ['the product match is weak'],
  sources: ['https://shop.example/p/1', 'http://insecure.example/x'],
  lookup: {
    state: 'found',
    read: '雪花ラミィ / Relax time',
    detail: '1 of 30 pictures show this cover',
  },
  generator: 'gleamshelf 0.0.1',
  ...over,
});
const send = (token: string, d: unknown, photo: Buffer | null = PHOTO, type = 'image/jpeg') => {
  const r = http
    .post('/gleamshelf/imports')
    .set({ Authorization: `Bearer ${token}` })
    .field('draft', JSON.stringify(d));
  return photo ? r.attach('photo', photo, { filename: 'p.jpg', contentType: type }) : r;
};

async function connectedApp() {
  const code = (
    await http.post('/admin/imports/pairing').set({ Authorization: owner.auth }).expect(200)
  ).body.code as string;
  const paired = await http
    .post('/gleamshelf/pair')
    .send({ code, label: 'Back office Mac' })
    .expect(200);
  return { code, token: paired.body.token as string };
}

describe('connecting a Gleamshelf app', () => {
  it('lets only the owner show a code, and the code is eight digits that work once', async () => {
    await http.post('/admin/imports/pairing').set({ Authorization: staff.auth }).expect(403);
    await http.post('/admin/imports/pairing').expect(401);
    const { code, token } = await connectedApp();
    expect(code).toMatch(/^\d{4}-\d{4}$/);
    expect(token).toMatch(/^gst_/);
    const reuse = await http.post('/gleamshelf/pair').send({ code }).expect(400);
    expect(reuse.body.error).toMatch(/wrong or has expired/);
  });

  it("refuses a wrong code, and a new code replaces the person's earlier unused one", async () => {
    await http.post('/gleamshelf/pair').send({ code: '0000-0000' }).expect(400);
    const first = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth }))
      .body.code;
    const second = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth }))
      .body.code;
    await http.post('/gleamshelf/pair').send({ code: first }).expect(400);
    await http.post('/gleamshelf/pair').send({ code: second }).expect(200);
  });

  it('needs the token for everything else, and a disconnected app stops working', async () => {
    await http.get('/gleamshelf/ping').expect(401);
    await http.get('/gleamshelf/ping').set({ Authorization: 'Bearer gst_nonsense' }).expect(401);
    await http.get('/gleamshelf/ping').set({ Authorization: shopper.auth }).expect(401); // a shopper's sign-in is not an app token
    const { token } = await connectedApp();
    await http
      .get('/gleamshelf/ping')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    const list = (
      await http.get('/admin/imports/connections').set({ Authorization: owner.auth }).expect(200)
    ).body.connections as { id: string; label: string }[];
    const mine = list.find((c) => c.label === 'Back office Mac')!;
    await http
      .delete(`/admin/imports/connections/${mine.id}`)
      .set({ Authorization: staff.auth })
      .expect(403);
    await http
      .delete(`/admin/imports/connections/${mine.id}`)
      .set({ Authorization: owner.auth })
      .expect(200);
    await http
      .get('/gleamshelf/ping')
      .set({ Authorization: `Bearer ${token}` })
      .expect(401);
  });

  it("tells the app the shop's own categories and series", async () => {
    const { token } = await connectedApp();
    await http
      .post('/admin/series')
      .set({ Authorization: staff.auth })
      .send({ name: 'hololive' })
      .expect(200);
    const config = (
      await http
        .get('/gleamshelf/config')
        .set({ Authorization: `Bearer ${token}` })
        .expect(200)
    ).body;
    expect(config.categories).toContain('Bishoujo Figures');
    expect(config.categories.at(-1)).toBe('Other');
    expect(config.series).toContain('hololive');
  });
});

describe('drafts', () => {
  it('stores a draft with its photo, keeps only what it understands, and shows it to staff', async () => {
    const { token } = await connectedApp();
    const sent = await send(token, draft()).expect(200);
    expect(sent.body).toMatchObject({ success: true, created: true, status: 'draft' });
    const got = (
      await http
        .get(`/admin/imports/${sent.body.id}`)
        .set({ Authorization: staff.auth })
        .expect(200)
    ).body.draft;
    expect(got).toMatchObject({
      status: 'draft',
      title: 'Yukihana Lamy Figure (hololive)',
      category: 'Bishoujo Figures',
      series: 'hololive',
    });
    expect(got.imageUrl).toMatch(/^https?:\/\//);
    expect(got.details.sources).toEqual(['https://shop.example/p/1']); // the insecure address is dropped
    expect(got.details.lookup.state).toBe('found');
    await http
      .get(`/admin/imports/${sent.body.id}`)
      .set({ Authorization: shopper.auth })
      .expect(403);
  });

  it('replaces a draft sent again for the same photo instead of piling up copies', async () => {
    const { token } = await connectedApp();
    const first = await send(
      token,
      draft({ sourceKey: 'again-again-1', title: 'First try' }),
    ).expect(200);
    const second = await send(
      token,
      draft({ sourceKey: 'again-again-1', title: 'Second try' }),
    ).expect(200);
    expect(second.body).toMatchObject({ id: first.body.id, created: false, status: 'draft' });
    const list = (await http.get('/admin/imports').set({ Authorization: staff.auth }).expect(200))
      .body.imports as { id: string; title: string }[];
    expect(list.filter((d) => d.id === first.body.id).map((d) => d.title)).toEqual(['Second try']);
  });

  it('refuses a draft with no title, a bad key, no photo, or something that is not an image', async () => {
    const { token } = await connectedApp();
    expect((await send(token, draft({ title: '  ' })).expect(400)).body.error).toMatch(
      /needs a title/,
    );
    await send(token, draft({ sourceKey: 'no spaces allowed!' })).expect(400);
    await send(token, draft({ sourceKey: 'no-photo-key-1' }), null).expect(400);
    await send(
      token,
      draft({ sourceKey: 'not-an-image-1' }),
      Buffer.from('hello'),
      'text/plain',
    ).expect(400);
    await http
      .post('/gleamshelf/imports')
      .set({ Authorization: `Bearer ${token}` })
      .field('draft', '{not json')
      .attach('photo', PHOTO, { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await send('gst_wrong', draft()).expect(401);
  });
});

describe('deciding on a draft', () => {
  it("adds it through the quick add with the draft's photo and what the staff member typed, and does not add it twice", async () => {
    const { token } = await connectedApp();
    const id = (await send(token, draft({ sourceKey: 'to-be-added-1' })).expect(200)).body
      .id as string;
    const imageUrl = (await http.get(`/admin/imports/${id}`).set({ Authorization: staff.auth }))
      .body.draft.imageUrl as string;
    const add = vi.spyOn(quickAdd, 'add').mockResolvedValue({ id: 'SQ_NEW', name: 'x', photos: 1 });
    const body = {
      name: 'Yukihana Lamy Figure (hololive)',
      priceCents: 4500,
      stockCount: 1,
      category: 'Bishoujo Figures',
      series: 'hololive',
      hidden: true,
    };
    await http
      .post(`/admin/imports/${id}/add`)
      .set({ Authorization: shopper.auth })
      .send(body)
      .expect(403);
    const done = await http
      .post(`/admin/imports/${id}/add`)
      .set({ Authorization: staff.auth })
      .send(body)
      .expect(200);
    expect(done.body.product.id).toBe('SQ_NEW');
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0][1]).toMatchObject({
      name: body.name,
      priceCents: 4500,
      stockCount: 1,
      imageUrls: [imageUrl],
      hidden: true,
    });
    const after = (await http.get(`/admin/imports/${id}`).set({ Authorization: staff.auth })).body
      .draft;
    expect(after).toMatchObject({ status: 'added', productId: 'SQ_NEW', imageUrl: null });
    expect(
      (
        await http
          .post(`/admin/imports/${id}/add`)
          .set({ Authorization: staff.auth })
          .send(body)
          .expect(409)
      ).body.error,
    ).toMatch(/already added/);
    // sending the same photo again does not bring it back
    expect(
      (await send(token, draft({ sourceKey: 'to-be-added-1' })).expect(200)).body,
    ).toMatchObject({ created: false, status: 'added' });
    add.mockRestore();
  });

  it('leaves the draft a draft when the add fails, so it can be tried again', async () => {
    const { token } = await connectedApp();
    const id = (await send(token, draft({ sourceKey: 'add-fails-key1' })).expect(200)).body
      .id as string;
    const add = vi.spyOn(quickAdd, 'add').mockRejectedValueOnce(new Error('Square is down'));
    const body = { name: 'X', priceCents: 1000 };
    await http
      .post(`/admin/imports/${id}/add`)
      .set({ Authorization: staff.auth })
      .send(body)
      .expect(500);
    expect(
      (await http.get(`/admin/imports/${id}`).set({ Authorization: staff.auth })).body.draft.status,
    ).toBe('draft');
    add.mockResolvedValueOnce({ id: 'SQ_2', name: 'X', photos: 1 });
    await http
      .post(`/admin/imports/${id}/add`)
      .set({ Authorization: staff.auth })
      .send(body)
      .expect(200);
    add.mockRestore();
  });

  it('rejects a draft, drops its photo, and counts drafts by status', async () => {
    const { token } = await connectedApp();
    const id = (await send(token, draft({ sourceKey: 'to-be-rejected1' })).expect(200)).body
      .id as string;
    await http
      .post(`/admin/imports/${id}/reject`)
      .set({ Authorization: staff.auth })
      .send({ reason: 'wrong product' })
      .expect(200);
    expect(JSON.stringify(storage.calls.filter((c) => c.body?.prefixes))).toMatch(/imports\//); // its photo was deleted from storage
    const got = (await http.get(`/admin/imports/${id}`).set({ Authorization: staff.auth })).body
      .draft;
    expect(got).toMatchObject({
      status: 'rejected',
      rejectReason: 'wrong product',
      imageUrl: null,
    });
    await http
      .post(`/admin/imports/${id}/reject`)
      .set({ Authorization: staff.auth })
      .send({})
      .expect(409);
    const rejected = (
      await http.get('/admin/imports?status=rejected').set({ Authorization: staff.auth })
    ).body;
    expect(rejected.imports.map((d: { id: string }) => d.id)).toContain(id);
    expect(rejected.counts.rejected).toBeGreaterThanOrEqual(1);
    await http.get('/admin/imports').expect(401);
  });
});
