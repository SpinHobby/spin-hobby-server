import { afterAll, describe, expect, it, vi } from 'vitest';
import { QuickAddService } from '../../src/modules/admin/products/quick-add.service.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
/** Our photo storage (Supabase) stands in; the draft routes talk to nothing else. */
const storage = mockFetch({
  'https://proj.supabase.co/storage/v1/object/product-images': () => [],
  // a maker's official photo (the only outside address a draft may name)
  'https://assets.1kuji.com/up/': () =>
    new Response(Buffer.from('official-jpeg'), { headers: { 'content-type': 'image/jpeg' } }),
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

describe("the maker's official photo", () => {
  const official = {
    imageUrl: 'https://assets.1kuji.com/up/rem-a.jpg',
    pageUrl: 'https://1kuji.com/products/re-zero14',
    site: 'ignored',
  };
  const body = { name: 'Rem Figure (Re:Zero)', priceCents: 4500, stockCount: 1 };
  const addDraft = async (key: string, extra: Record<string, unknown>) => {
    const { token } = await connectedApp();
    const id = (await send(token, draft({ sourceKey: key, ...extra })).expect(200)).body
      .id as string;
    const d = (await http.get(`/admin/imports/${id}`).set({ Authorization: staff.auth })).body
      .draft as { imageUrl: string; details: { official: unknown } };
    return { id, d };
  };

  it("keeps a photo from a maker's site, and drops one from anywhere else", async () => {
    const kept = await addDraft('official-key-01', { official });
    expect(kept.d.details.official).toEqual({ ...official, site: '1kuji.com' });
    const elsewhere = await addDraft('official-key-02', {
      official: { ...official, imageUrl: 'https://jp.mercari.com/photo.jpg' },
    });
    expect(elsewhere.d.details.official).toBeNull();
    const plain = await addDraft('official-key-03', {
      official: { ...official, imageUrl: 'http://assets.1kuji.com/up/a.jpg' },
    });
    expect(plain.d.details.official).toBeNull();
  });

  it('adds with the official photo, or with both (own first), or with our own by default', async () => {
    const add = vi.spyOn(quickAdd, 'add').mockResolvedValue({ id: 'SQ_O', name: 'x', photos: 1 });
    const one = await addDraft('official-key-04', { official });
    await http
      .post(`/admin/imports/${one.id}/add`)
      .set({ Authorization: staff.auth })
      .send({ ...body, photo: 'official' })
      .expect(200);
    const used = add.mock.calls[0][1].imageUrls;
    expect(used).toHaveLength(1);
    expect(used[0]).not.toBe(one.d.imageUrl); // a copy in our own storage, not the maker's address
    expect(used[0]).toMatch(/^https:\/\/proj\.supabase\.co\//);
    const both = await addDraft('official-key-05', { official });
    await http
      .post(`/admin/imports/${both.id}/add`)
      .set({ Authorization: staff.auth })
      .send({ ...body, photo: 'both' })
      .expect(200);
    expect(add.mock.calls[1][1].imageUrls[0]).toBe(both.d.imageUrl);
    expect(add.mock.calls[1][1].imageUrls).toHaveLength(2);
    const own = await addDraft('official-key-06', { official });
    await http
      .post(`/admin/imports/${own.id}/add`)
      .set({ Authorization: staff.auth })
      .send(body)
      .expect(200);
    expect(add.mock.calls[2][1].imageUrls).toEqual([own.d.imageUrl]);
    add.mockRestore();
  });

  it('refuses the official photo when the draft has none, and leaves the draft a draft when it cannot be downloaded', async () => {
    const none = await addDraft('official-key-07', {});
    const refused = await http
      .post(`/admin/imports/${none.id}/add`)
      .set({ Authorization: staff.auth })
      .send({ ...body, photo: 'official' })
      .expect(409);
    expect(refused.body.error).toMatch(/no official photo/);
    const gone = await addDraft('official-key-08', {
      official: { ...official, imageUrl: 'https://assets.1kuji.com/gone/x.jpg' },
    });
    await http
      .post(`/admin/imports/${gone.id}/add`)
      .set({ Authorization: staff.auth })
      .send({ ...body, photo: 'official' })
      .expect(502);
    const after = (await http.get(`/admin/imports/${gone.id}`).set({ Authorization: staff.auth }))
      .body.draft;
    expect(after.status).toBe('draft');
  });
});

describe('market prices on a draft', () => {
  const market = {
    low: 38.38,
    median: 39.69,
    high: 41,
    count: 2,
    canadian: 1,
    rate: 1.4,
    rateIsEstimate: false,
    note: 'Only 2 matching listings found.',
    listings: [
      {
        title: 'Relax Time Prize Figure',
        url: 'https://otakuowlet.com/p/1',
        site: 'otakuowlet.com',
        price: 41,
        currency: 'CAD',
        cad: 41,
        condition: 'new',
        canadian: true,
      },
      {
        title: 'Relax Time',
        url: 'https://otakumode.com/p/2',
        site: 'otakumode.com',
        price: 26.99,
        currency: 'USD',
        cad: 37.79,
        condition: null,
        canadian: false,
      },
      {
        title: 'not https',
        url: 'http://insecure.example/x',
        site: 'x',
        price: 5,
        currency: 'USD',
        cad: 7,
        condition: null,
        canadian: false,
      },
      {
        title: 'no price',
        url: 'https://nope.example/x',
        site: 'x',
        price: 0,
        currency: 'USD',
        cad: 0,
        condition: null,
        canadian: false,
      },
    ],
  };
  const stored = async (token: string, key: string, extra: Record<string, unknown>) => {
    await send(token, draft({ sourceKey: key, ...extra })).expect(200);
    const list = (await http.get('/admin/imports').set({ Authorization: staff.auth }).expect(200))
      .body.imports as { details: { market: unknown }; title: string }[];
    return list.find((d) => d.title === 'Yukihana Lamy Figure (hololive)') ?? list[0];
  };

  it('keeps the listings with a price and an https link, and drops the rest', async () => {
    const { token } = await connectedApp();
    const d = (await stored(token, 'market-key-0001', { market })).details.market as {
      listings: { url: string }[];
      median: number;
      count: number;
    };
    expect(d.median).toBe(39.69);
    expect(d.count).toBe(2);
    expect(d.listings.map((l) => l.url)).toEqual([
      'https://otakuowlet.com/p/1',
      'https://otakumode.com/p/2',
    ]);
  });

  it('keeps no market when it is missing or unreadable', async () => {
    const { token } = await connectedApp();
    expect((await stored(token, 'market-key-0002', {})).details.market).toBeNull();
    expect((await stored(token, 'market-key-0003', { market: 'cheap' })).details.market).toBeNull();
    expect(
      (await stored(token, 'market-key-0004', { market: { ...market, listings: [] } })).details
        .market,
    ).toBeNull();
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
