import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;

describe('shop categories', () => {
  const ids: Record<string, string> = {};
  const create = (name: string, parentId?: string) =>
    http
      .post('/admin/categories')
      .set('Authorization', staff.auth)
      .send({ name, parentId: parentId ?? null });

  it('builds a tree of categories and subcategories of any depth', async () => {
    await http
      .post('/admin/categories')
      .set('Authorization', shopper.auth)
      .send({ name: 'Nope' })
      .expect(403);
    ids.figures = (await create('Figures').expect(200)).body.category.id;
    ids.scale = (await create('Scale Figures', ids.figures).expect(200)).body.category.id;
    ids.prize = (await create('Prize Figures', ids.figures).expect(200)).body.category.id;
    ids.limited = (await create('Limited Editions', ids.scale).expect(200)).body.category.id; // 3rd level
    ids.goods = (await create('Goods').expect(200)).body.category.id;
    await create('  scale   figures ', ids.figures).expect(409, {
      success: false,
      error: 'A category with that name already exists here.',
    });
    await create('Scale Figures', ids.goods).expect(200); // same name under a different parent is fine
    await create('', ids.figures).expect(400);
    await create('Orphan', '00000000-0000-4000-8000-000000000000').expect(404);
    const list = (await http.get('/admin/categories').set('Authorization', staff.auth).expect(200))
      .body.categories;
    expect(
      list.filter((c: any) => c.parentId === ids.figures).map((c: any) => [c.name, c.sortOrder]),
    ).toEqual([
      ['Scale Figures', 0],
      ['Prize Figures', 1],
    ]);
  });

  it('prevents loops and reorders siblings', async () => {
    await http
      .put(`/admin/categories/${ids.figures}`)
      .set('Authorization', staff.auth)
      .send({ parentId: ids.limited })
      .expect(400, { success: false, error: "A category can't be moved inside itself." });
    await http
      .put(`/admin/categories/${ids.figures}`)
      .set('Authorization', staff.auth)
      .send({ parentId: ids.figures })
      .expect(400);
    await http
      .put('/admin/categories/reorder')
      .set('Authorization', staff.auth)
      .send({ ids: [ids.prize, ids.scale] })
      .expect(200);
    const kids = (await http.get('/categories')).body.categories.filter(
      (c: any) => c.parentId === ids.figures,
    );
    expect(kids.map((c: any) => c.name)).toEqual(['Prize Figures', 'Scale Figures']);
  });

  it('assigns products (single and bulk) and exposes the category to the storefront', async () => {
    await http
      .patch('/admin/products/FIG1')
      .set('Authorization', staff.auth)
      .send({ category_id: 'not-a-uuid' })
      .expect(400);
    await http
      .patch('/admin/products/FIG1')
      .set('Authorization', staff.auth)
      .send({ category_id: ids.limited })
      .expect(200);
    const bulk = await http
      .post('/admin/products/bulk-category')
      .set('Authorization', staff.auth)
      .send({ ids: ['PRZ1', 'CHB1', 'NOPE'], categoryId: ids.prize })
      .expect(200);
    expect(bulk.body.updated).toBe(2);
    const fig = (await http.get('/square/catalog/FIG1')).body.item;
    expect(fig).toMatchObject({ category: 'Limited Editions', categoryId: ids.limited });
    const counts = Object.fromEntries(
      (await http.get('/admin/categories').set('Authorization', staff.auth)).body.categories.map(
        (c: any) => [c.name, c.productCount],
      ),
    );
    expect(counts).toMatchObject({ 'Limited Editions': 1, 'Prize Figures': 2, Figures: 0 });
    // Storefront: totals roll up into parents, and a parent filter includes its whole branch.
    const facets = (await http.get('/products/facets')).body;
    const totals = Object.fromEntries(facets.shopCategories.map((c: any) => [c.name, c.total]));
    expect(totals).toEqual({
      Figures: 3,
      'Scale Figures': 1,
      'Limited Editions': 1,
      'Prize Figures': 2,
    });
    expect(
      (await http.get(`/products?categoryId=${ids.figures}&limit=60`)).body.items
        .map((p: any) => p.id)
        .sort(),
    ).toEqual(['CHB1', 'FIG1', 'PRZ1']);
    expect(
      (await http.get(`/products?categoryId=${ids.scale}`)).body.items.map((p: any) => p.id),
    ).toEqual(['FIG1']);
    expect(
      (await http.get('/products?q=limited%20editions')).body.items.map((p: any) => p.id),
    ).toEqual(['FIG1']); // search matches category names
  });

  it('hides a hidden branch from storefront navigation', async () => {
    await http
      .put(`/admin/categories/${ids.scale}`)
      .set('Authorization', staff.auth)
      .send({ isVisible: false })
      .expect(200);
    const names = (await http.get('/homepage')).body.categories.map((c: any) => c.name);
    expect(names).toContain('Prize Figures');
    expect(names).not.toContain('Limited Editions'); // child of the hidden category
    await http
      .put(`/admin/categories/${ids.scale}`)
      .set('Authorization', staff.auth)
      .send({ isVisible: true, name: 'Scale Figures 1/7' })
      .expect(200);
    expect((await http.get('/categories')).body.categories.map((c: any) => c.name)).toContain(
      'Scale Figures 1/7',
    );
  });

  it('deletes a branch and leaves its products uncategorised', async () => {
    const res = await http
      .delete(`/admin/categories/${ids.figures}`)
      .set('Authorization', staff.auth)
      .expect(200);
    expect(res.body).toEqual({ success: true, deletedCategories: 4, uncategorisedProducts: 3 });
    expect((await http.get('/square/catalog/FIG1')).body.item).toMatchObject({
      categoryId: null,
      category: 'Scale Figures',
    }); // back to the Square category
    expect((await http.get('/categories')).body.categories.map((c: any) => c.name).sort()).toEqual([
      'Goods',
      'Scale Figures',
    ]);
  });
});
