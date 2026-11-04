import { afterAll, describe, expect, it } from 'vitest';
import { seedProduct } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff, shopper, pglite } = shop;
const asStaff = { Authorization: staff.auth };

// FIG1 already has a JAN code; these two have photos and no barcode
await seedProduct(pglite, {
  id: 'PLU1',
  name: 'Mascot Plush',
  category: 'Plushies',
  priceCents: 3200,
  stock: 4,
  image: 'https://img/plu1.jpg',
});
await seedProduct(pglite, {
  id: 'NEN1',
  name: 'Nendoroid Frieren',
  category: 'Nendoroids',
  priceCents: 6900,
  stock: 4,
  image: 'https://img/nen1.jpg',
});

/** A connected photo computer. */
async function app() {
  const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
    .code as string;
  const token = (await http.post('/gleamshelf/pair').send({ code, label: 'Gaming PC' })).body
    .token as string;
  const as = { Authorization: `Bearer ${token}` };
  return {
    claim: async () =>
      (await http.post('/gleamshelf/barcode-jobs/claim').set(as).expect(200)).body.products,
    report: (results: unknown[]) =>
      http.post('/gleamshelf/barcode-jobs/result').set(as).send({ results }),
  };
}

describe('barcodes from the photo computer', () => {
  it('needs the app token or staff', async () => {
    await http.post('/gleamshelf/barcode-jobs/claim').expect(401);
    await http.get('/admin/barcodes').set({ Authorization: shopper.auth }).expect(403);
  });

  it('hands out visible products with photos and no barcode, once, with their photos', async () => {
    const worker = await app();
    const products = await worker.claim();
    const ids = products.map((p: { productId: string }) => p.productId);
    expect(ids).toEqual(expect.arrayContaining(['PLU1', 'NEN1']));
    expect(ids).not.toContain('FIG1'); // has a JAN code
    expect(ids).not.toContain('HID1'); // hidden
    expect(products.find((p: { productId: string }) => p.productId === 'PLU1')).toEqual({
      productId: 'PLU1',
      productName: 'Mascot Plush',
      photoUrls: ['https://img/plu1.jpg'],
    });
    expect(await worker.claim()).toEqual([]); // claimed: not handed out again

    const res = await worker
      .report([
        { productId: 'PLU1', code: '4549660000006', source: 'both' },
        { productId: 'NEN1', code: '4549660000002', source: 'photo' }, // wrong check digit: none
      ])
      .expect(200);
    expect(res.body.found).toBe(1);
    await worker.report([{ productId: 'x'.repeat(200), code: null }]).expect(400);
  });

  it('shows what was found; applying makes it the JAN code, used by the Google feed', async () => {
    const list = (await http.get('/admin/barcodes').set(asStaff).expect(200)).body;
    expect(list.found).toEqual([
      expect.objectContaining({
        productId: 'PLU1',
        code: '4549660000006',
        source: 'both',
        image: 'https://img/plu1.jpg',
      }),
    ]);
    expect(list.counts).toMatchObject({ none: 1 });

    const done = (await http.post('/admin/barcodes/apply-agreed').set(asStaff).expect(200)).body;
    expect(done).toMatchObject({ applied: 1, skipped: [] });
    const feed = (await http.get('/products/feed').expect(200)).body.items;
    expect(feed.find((p: { id: string }) => p.id === 'PLU1').janCode).toBe('4549660000006');
    expect((await http.get('/admin/barcodes').set(asStaff).expect(200)).body.found).toEqual([]);
    await http.post('/admin/barcodes/PLU1/apply').set(asStaff).expect(404); // already decided
  });

  it('keeps a barcode the product pages gave while describing, and refuses one another product already has', async () => {
    await seedProduct(pglite, {
      id: 'CAP1',
      name: 'Embroidered Cap',
      category: 'Goods',
      priceCents: 3000,
      stock: 4,
      image: 'https://img/cap1.jpg',
    });
    await http
      .post('/admin/describe-jobs')
      .set(asStaff)
      .send({ ids: ['CAP1'] })
      .expect(200);
    const code = (await http.post('/admin/imports/pairing').set({ Authorization: owner.auth })).body
      .code as string;
    const token = (await http.post('/gleamshelf/pair').send({ code, label: 'Laptop' })).body
      .token as string;
    const as = { Authorization: `Bearer ${token}` };
    const job = (
      await http
        .post('/gleamshelf/describe-jobs/claim')
        .set(as)
        .send({ features: ['photo', 'listing', 'describe'] })
        .expect(200)
    ).body.job;
    expect(job.productId).toBe('CAP1');
    await http
      .post(`/gleamshelf/describe-jobs/${job.id}/result`)
      .set(as)
      .send({
        result: {
          description:
            'An embroidered cap with the series logo on the front, one size with an adjustable strap.',
          barcode: { code: '4549660000006', source: 'page' }, // the plush has this one now
        },
      })
      .expect(200);
    const found = (await http.get('/admin/barcodes').set(asStaff).expect(200)).body.found;
    expect(found).toEqual([expect.objectContaining({ productId: 'CAP1', source: 'page' })]);
    const refused = await http.post('/admin/barcodes/CAP1/apply').set(asStaff).expect(409);
    expect(refused.body.error ?? refused.body.message).toContain('Mascot Plush');
    await http.post('/admin/barcodes/CAP1/dismiss').set(asStaff).expect(200);
    expect((await http.get('/admin/barcodes').set(asStaff).expect(200)).body.found).toEqual([]);
  });
});
