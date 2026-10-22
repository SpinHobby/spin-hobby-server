import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite } = shop;

describe('storefront catalog', () => {
  it('lists visible products in the public shape and hides hidden ones', async () => {
    const res = await http.get('/products?limit=60').expect(200);
    expect(res.body.total).toBe(5);
    expect(res.body.items.map((p: any) => p.id)).not.toContain('HID1');
    const fig = res.body.items.find((p: any) => p.id === 'FIG1');
    expect(fig).toEqual({
      id: 'FIG1',
      variationId: 'FIG1_V',
      name: 'Rem 1/7 Scale Figure',
      series: 'Re:Zero',
      character: null,
      category: 'Scale Figures',
      categoryId: null,
      images: ['https://img/fig1.jpg'],
      cutouts: [],
      priceCents: 22900,
      compareAtCents: null,
      currency: 'CAD',
      status: 'pre',
      stockCount: null,
      releaseMonth: '2027-03-01',
      orderByDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      rank: 1,
      maxPerCustomer: null,
    });
  });

  it('gives search engines every visible product with its description, JAN code and category path', async () => {
    const res = await http.get('/products/feed').expect(200);
    const ids = res.body.items.map((p: any) => p.id);
    expect(ids).toHaveLength(5);
    expect(ids).not.toContain('HID1');
    const fig = res.body.items.find((p: any) => p.id === 'FIG1');
    expect(fig).toMatchObject({
      id: 'FIG1',
      name: 'Rem 1/7 Scale Figure',
      priceCents: 22900,
      status: 'pre',
    });
    expect(fig).toHaveProperty('description');
    expect(fig).toHaveProperty('janCode');
    expect(fig).toHaveProperty('categoryPath');
    expect(fig).toHaveProperty('manufacturer');
    expect(fig.createdAt).toEqual(expect.any(String));
  });

  it('filters by series address form, whatever the punctuation', async () => {
    expect((await http.get('/products?series=re-zero')).body.items.map((p: any) => p.id)).toEqual([
      'FIG1',
    ]);
    expect((await http.get('/products?series=RE-ZERO')).body.items.map((p: any) => p.id)).toEqual([
      'FIG1',
    ]);
    expect((await http.get('/products?series=no-such-series')).body.items).toEqual([]);
  });

  it('derives status from stock and pre-order dates like the storefront expects', async () => {
    const res = await http.get('/products?limit=60').expect(200);
    const status = Object.fromEntries(res.body.items.map((p: any) => [p.id, p.status]));
    expect(status).toMatchObject({
      FIG1: 'pre',
      PRZ1: 'in',
      CHB1: 'low',
      BDG1: 'out',
      OLD1: 'closed',
    });
  });

  it('filters by category, status, price and search (series / JAN) and pages with a cursor', async () => {
    expect(
      (await http.get('/products?category=Prize%20Figures')).body.items.map((p: any) => p.id),
    ).toEqual(['PRZ1']);
    expect(
      (await http.get('/products?status=in,low&sort=price_asc')).body.items.map((p: any) => p.id),
    ).toEqual(['PRZ1', 'CHB1']);
    expect(
      (await http.get('/products?min=50&max=100')).body.items.map((p: any) => p.id).sort(),
    ).toEqual(['CHB1', 'OLD1']);
    expect((await http.get('/products?min=25&max=39')).body.items).toEqual([]); // max is exclusive ($39 falls in the next bucket)
    expect((await http.get('/products?q=re:zero')).body.items.map((p: any) => p.id)).toEqual([
      'FIG1',
    ]);
    expect((await http.get('/products?q=4580000000001')).body.items.map((p: any) => p.id)).toEqual([
      'FIG1',
    ]);
    expect((await http.get('/products?q=100%25')).body.items).toEqual([]); // LIKE wildcards are escaped
    const first = (await http.get('/products?limit=2&sort=price_desc')).body;
    expect(first.cursor).toBe('2');
    const second = (await http.get(`/products?limit=2&sort=price_desc&cursor=${first.cursor}`))
      .body;
    expect([...first.items, ...second.items].map((p: any) => p.id)).toEqual([
      'FIG1',
      'CHB1',
      'OLD1',
      'PRZ1',
    ]);
  });

  it('serves facets, shortcut lists and the homepage payload', async () => {
    const facets = (await http.get('/products/facets').expect(200)).body;
    expect(facets.status).toEqual({ in: 2, pre: 1, out: 2 });
    expect(facets.price.map((b: any) => b.count)).toEqual([1, 3, 0, 1]); // $18 | $39 $55 $64 | - | $229
    expect((await http.get('/products/preorders')).body.items.map((p: any) => p.id)).toEqual([
      'FIG1',
    ]);
    expect((await http.get('/products/ranking')).body.items.map((p: any) => p.id)).toEqual([
      'FIG1',
      'PRZ1',
    ]);
    const home = (await http.get('/homepage').expect(200)).body;
    expect(home.featuredItems.map((p: any) => p.id)).toEqual(['FIG1']);
    expect(home.preorders.map((p: any) => p.id)).toEqual(['FIG1']);
    expect(home.newInStock.map((p: any) => p.id).sort()).toEqual(['CHB1', 'PRZ1']);
    expect(home.categories).toEqual([]);
    // No slides/events configured yet: the server supplies the welcome defaults.
    expect(home.slides.map((sl: any) => sl.headline)).toEqual([
      'New arrivals every week',
      'Free shipping on orders $75+',
      'Join our Discord community',
    ]);
    expect(home.events.map((e: any) => e.name)).toContain('Otafest');
    expect(home.promos).toEqual({ closingSoon: 1, maxDiscountPct: 19 }); // FIG1 closes in 20 days; CHB1 $64 vs $79
  });

  it('exposes public checkout config driven by store settings', async () => {
    const res = await http.get('/checkout/config').expect(200);
    expect(res.body).toMatchObject({
      provider: 'paypal',
      paypalClientId: 'pp-client',
      squareEnv: 'sandbox',
      freeShippingThresholdCents: 7500,
      handlingDaysMin: 2,
      handlingDaysMax: 3,
      fxCadUsd: 0.73,
    });
  });
});

describe('storefront sections and server-side filters', () => {
  it('filters by menu section, sale, wishlist ids and featured order', async () => {
    const ids = (url: string) => http.get(url).then((r) => r.body.items.map((p: any) => p.id));
    expect((await ids('/products?group=figures&limit=60')).sort()).toEqual([
      'CHB1',
      'FIG1',
      'PRZ1',
    ]);
    expect(await ids('/products?group=preorders')).toEqual(['FIG1']);
    expect((await ids('/products?group=new&limit=60')).sort()).toEqual(['CHB1', 'PRZ1']);
    expect(await ids('/products?group=sale')).toEqual(['CHB1']);
    expect(await ids('/products?group=plushies')).toEqual(['OLD1']);
    expect((await ids('/products?ids=PRZ1,BDG1,HID1')).sort()).toEqual(['BDG1', 'PRZ1']);
    expect(await ids('/products?ids=')).toEqual([]);
    expect((await ids('/products?sort=featured&limit=60'))[0]).toBe('FIG1');
    await http
      .get('/products?group=nonsense')
      .expect(400, { success: false, error: 'Unknown section.' });
    await http.get('/products?categoryId=nope').expect(400);
  });
});

describe('new arrivals', () => {
  it('go by the day a product was added in Square, not when it was last synced or first seen here', async () => {
    const order = async () =>
      ((await http.get('/homepage').expect(200)).body.newInStock as { id: string }[]).map(
        (p) => p.id,
      );
    // Square says CHB1 was added long ago and PRZ1 recently, even though our own rows were all created together.
    await pglite.query(
      "update public.catalog_products set square_created_at = '2026-01-01T00:00:00Z' where square_item_id = 'CHB1'",
    );
    await pglite.query(
      "update public.catalog_products set square_created_at = '2026-10-01T00:00:00Z' where square_item_id = 'PRZ1'",
    );
    expect(await order()).toEqual(['PRZ1', 'CHB1']);
    // A later edit or sync (updated_at) changes nothing.
    await pglite.query(
      "update public.catalog_products set updated_at = now() where square_item_id = 'CHB1'",
    );
    expect(await order()).toEqual(['PRZ1', 'CHB1']);
    // And the other way round.
    await pglite.query(
      "update public.catalog_products set square_created_at = '2025-01-01T00:00:00Z' where square_item_id = 'PRZ1'",
    );
    expect(await order()).toEqual(['CHB1', 'PRZ1']);
  });
});
