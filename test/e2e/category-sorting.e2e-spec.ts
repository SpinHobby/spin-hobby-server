import { afterAll, describe, expect, it } from 'vitest';
import { seedProduct } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, staff, shopper } = shop;
const as = (who: { auth: string }) => ({ Authorization: who.auth });

const categoryIds = async () =>
  Object.fromEntries(
    (await http.get('/admin/categories').set(as(staff)).expect(200)).body.categories.map(
      (c: { name: string; id: string }) => [c.name, c.id],
    ),
  );

describe('the ready-made category tree', () => {
  it('shows what the shop already has, then adds only what is missing', async () => {
    // the shop already made "Figures" and "Plush" under its own "Character Goods"
    const figures = (
      await http.post('/admin/categories').set(as(staff)).send({ name: 'figures' }).expect(200)
    ).body.category.id;
    await http.post('/admin/categories').set(as(staff)).send({ name: 'My own corner' }).expect(200);

    const preview = await http.get('/admin/categories/standard').set(as(staff)).expect(200);
    expect(preview.body.tree[0]).toMatchObject({ name: 'Figures', exists: true });
    expect(preview.body.tree[0].children[0]).toEqual({ name: 'Bishoujo Figures', exists: false });

    const res = await http.post('/admin/categories/standard').set(as(staff)).expect(200);
    expect(res.body.created).not.toContain('Figures');
    expect(res.body.created).toContain('Figures › Bishoujo Figures');
    expect(res.body.created).toContain('Character Goods');

    const all = (await http.get('/admin/categories').set(as(staff))).body.categories;
    expect(
      all
        .filter((c: { parentId: string }) => c.parentId === figures)
        .map((c: { name: string }) => c.name),
    ).toEqual([
      'Bishoujo Figures',
      'Character Figures',
      'Kuji Prize Figures',
      'Action Figures',
      'Chibi Figures',
      'Trading & Blind Box Figures',
      'Dolls',
    ]);
    expect(all.some((c: { name: string }) => c.name === 'My own corner')).toBe(true); // the shop's own categories stay

    // running it again changes nothing
    expect(
      (await http.post('/admin/categories/standard').set(as(staff)).expect(200)).body.created,
    ).toEqual([]);
  });
});

describe('sorting products into categories', () => {
  it('suggests a category for each uncategorised product, and applies only what a person sends', async () => {
    await seedProduct(pglite, {
      id: 'ACR1',
      name: 'Frieren Acrylic Stand',
      category: 'Goods',
      priceCents: 1500,
    });
    await seedProduct(pglite, {
      id: 'POP1',
      name: 'Pop Up Parade Makima',
      category: 'Figures',
      priceCents: 5500,
    });
    await seedProduct(pglite, {
      id: 'GOJO1',
      name: 'Satoru Gojo Prize Figure',
      category: 'Action Figures',
      priceCents: 3500,
    });
    const ids = await categoryIds();

    const res = await http.get('/admin/categories/suggestions').set(as(staff)).expect(200);
    const by = Object.fromEntries(res.body.items.map((i: { id: string }) => [i.id, i]));
    expect(by.ACR1).toMatchObject({
      suggestedCategoryId: ids['Acrylic Stands & Keychains'],
      reason: '"Acrylic" in the name',
      currentCategoryId: null,
    });
    expect(by.GOJO1.suggestedCategoryId).toBe(ids['Kuji Prize Figures']);
    expect(by.POP1).toMatchObject({
      suggestedCategoryId: null,
      choices: [ids['Bishoujo Figures'], ids['Character Figures']],
    });
    expect(by.BDG1.suggestedCategoryId).toBe(ids['Can Badges & Pins']); // "Can Badge Set" from the shop's sample products

    const applied = await http
      .post('/admin/categories/assign')
      .set(as(staff))
      .send({
        assignments: [
          { id: 'ACR1', categoryId: ids['Acrylic Stands & Keychains'] },
          { id: 'POP1', categoryId: ids['Bishoujo Figures'] },
        ],
      })
      .expect(200);
    expect(applied.body.updated).toBe(2);

    const after = await http.get('/admin/categories/suggestions').set(as(staff)).expect(200);
    expect(after.body.items.map((i: { id: string }) => i.id)).not.toContain('ACR1');
    const everything = await http
      .get('/admin/categories/suggestions?all=1')
      .set(as(staff))
      .expect(200);
    expect(
      everything.body.items.find((i: { id: string }) => i.id === 'POP1').currentCategoryId,
    ).toBe(ids['Bishoujo Figures']);
  });

  it('checks the request and who is asking', async () => {
    await http
      .post('/admin/categories/assign')
      .set(as(staff))
      .send({ assignments: [] })
      .expect(400);
    await http
      .post('/admin/categories/assign')
      .set(as(staff))
      .send({ assignments: [{ id: 'ACR1', categoryId: null }] })
      .expect(400);
    await http
      .post('/admin/categories/assign')
      .set(as(staff))
      .send({ assignments: [{ id: 'ACR1', categoryId: '00000000-0000-4000-8000-000000000000' }] })
      .expect(404);
    await http.get('/admin/categories/suggestions').set(as(shopper)).expect(403);
    await http.post('/admin/categories/standard').set(as(shopper)).expect(403);
  });
});
