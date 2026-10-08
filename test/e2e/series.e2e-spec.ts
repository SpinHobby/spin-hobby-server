import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, staff, shopper } = shop;
const as = { Authorization: staff.auth };

const seriesList = async () => (await http.get('/admin/series').set(as).expect(200)).body.series;
const patch = (id: string, body: Record<string, unknown>) =>
  http.patch(`/admin/products/${id}`).set(as).send(body).expect(200);
const catalog = async (query: string) =>
  (await http.get(`/admin/catalog?${query}`).set(as).expect(200)).body;

describe('series list', () => {
  it('starts empty and adds a series, matching names ignoring case, spacing and punctuation', async () => {
    expect(await seriesList()).toEqual([]);
    const made = await http.post('/admin/series').set(as).send({ name: 'Re:Zero' }).expect(200);
    expect(made.body.series).toMatchObject({ name: 'Re:Zero', created: true });
    const again = await http.post('/admin/series').set(as).send({ name: ' re zero ' }).expect(200);
    expect(again.body.series).toMatchObject({
      id: made.body.series.id,
      name: 'Re:Zero',
      created: false,
    });
    expect(await seriesList()).toHaveLength(1);
  });

  it('links a product to a series by name and uses the spelling from the list', async () => {
    await patch('FIG1', { series: 'rezero' });
    await patch('PRZ1', { series: 'Vocaloid' });
    const list = await seriesList();
    expect(
      list.map((s: { name: string; productCount: number }) => [s.name, s.productCount]),
    ).toEqual([
      ['Re:Zero', 1],
      ['Vocaloid', 1],
    ]);
    const fig = (await catalog('q=FIG1')).items.find((i: { id: string }) => i.id === 'FIG1');
    expect(fig).toMatchObject({ series: 'Re:Zero', seriesId: expect.any(String) });
  });

  it('keeps series optional: blank clears it, and a product can have none', async () => {
    await patch('PRZ1', { series: '' });
    const prz = (await catalog('q=PRZ1')).items.find((i: { id: string }) => i.id === 'PRZ1');
    expect(prz).toMatchObject({ series: null, seriesId: null });
    // A product that never had a series is still fine, and shows under "none".
    const none = await catalog('seriesId=none&limit=100');
    expect(none.items.map((i: { id: string }) => i.id)).toContain('CHB1');
    expect(none.items.map((i: { id: string }) => i.id)).toContain('PRZ1');
  });

  it('filters the Products list by series', async () => {
    const id = (await seriesList()).find((s: { name: string }) => s.name === 'Re:Zero').id;
    const res = await catalog(`seriesId=${id}&limit=100`);
    expect(res.items.map((i: { id: string }) => i.id)).toEqual(['FIG1']);
    await http.get('/admin/catalog?seriesId=nope').set(as).expect(400);
  });

  it('renames a series and the products using it follow', async () => {
    const id = (await seriesList()).find((s: { name: string }) => s.name === 'Re:Zero').id;
    await http
      .put(`/admin/series/${id}`)
      .set(as)
      .send({ name: 'Re:Zero − Starting Life in Another World' })
      .expect(200);
    const fig = (await catalog('q=FIG1')).items.find((i: { id: string }) => i.id === 'FIG1');
    expect(fig.series).toBe('Re:Zero − Starting Life in Another World');
    // Aliases make other spellings match too.
    await http
      .put(`/admin/series/${id}`)
      .set(as)
      .send({ aliases: ['リゼロ'] })
      .expect(200);
    await patch('CHB1', { series: 'リゼロ' });
    const chb = (await catalog('q=CHB1')).items.find((i: { id: string }) => i.id === 'CHB1');
    expect(chb.seriesId).toBe(id);
    // Two series cannot share a name.
    await http.post('/admin/series').set(as).send({ name: 'Vocaloid' }).expect(200);
    const other = (await seriesList()).find((s: { name: string }) => s.name === 'Vocaloid').id;
    await http.put(`/admin/series/${other}`).set(as).send({ name: 'リゼロ' }).expect(409);
  });

  it('checks who is asking and what was asked', async () => {
    await http.get('/admin/series').expect(401);
    await http.get('/admin/series').set({ Authorization: shopper.auth }).expect(403);
    await http.post('/admin/series').set(as).send({ name: '' }).expect(400);
    await http.put('/admin/series/not-a-uuid').set(as).send({ name: 'X' }).expect(400);
    await http
      .put('/admin/series/00000000-0000-0000-0000-000000000000')
      .set(as)
      .send({ name: 'X' })
      .expect(404);
  });
});
