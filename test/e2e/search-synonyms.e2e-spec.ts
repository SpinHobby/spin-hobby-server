import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, shopper, staff } = shop;
const ids = async (q: string) =>
  (await http.get(`/products?q=${encodeURIComponent(q)}`)).body.items.map((p: any) => p.id);
const admin = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  http[method](`/admin/search-synonyms${path}`).set('Authorization', staff.auth);

describe('search synonyms in Admin', () => {
  it('starts with the seeded groups, sorted by kind', async () => {
    const { groups } = (await admin('get', '').expect(200)).body;
    expect(groups.length).toBeGreaterThan(100);
    expect(groups[0].kind).toBe('type');
    expect(groups.find((g: any) => g.terms.includes('初音ミク')).terms).toContain('hatsune miku');
  });

  it('applies a new group to the very next search, and takes it back when deleted', async () => {
    expect(await ids('レム')).toEqual([]);
    const { group } = (
      await admin('post', '')
        .send({ kind: 'series', terms: [' Rem ', 'レム', 'rem', ''] })
        .expect(201)
    ).body;
    expect(group.terms).toEqual(['Rem', 'レム']); // tidied, and "rem" is the same name as "Rem"
    expect(await ids('レム')).toEqual(['FIG1']);

    await admin('put', `/${group.id}`)
      .send({ kind: 'series', terms: ['Rem', 'レムりん'] })
      .expect(200);
    expect(await ids('レム')).toEqual([]); // still typed text, so a prefix of レムりん isn't enough
    expect(await ids('レムりん')).toEqual(['FIG1']);

    await admin('delete', `/${group.id}`).expect(200);
    await admin('delete', `/${group.id}`).expect(404);
    expect(await ids('レムりん')).toEqual([]);
  });

  it('refuses a name that is already in another group, and groups of one', async () => {
    const taken = await admin('post', '')
      .send({ kind: 'other', terms: ['Miku', 'ミクさん'] })
      .expect(409);
    expect(taken.body.error).toMatch(/already in the group "hatsune miku/);
    await admin('post', '')
      .send({ kind: 'other', terms: ['Pokémon', 'pokemon'] })
      .expect(400);
    await admin('post', '')
      .send({ kind: 'nope', terms: ['a', 'b'] })
      .expect(400);
  });

  it('is for staff only', async () => {
    await http.get('/admin/search-synonyms').set('Authorization', shopper.auth).expect(403);
    await http
      .post('/admin/search-synonyms')
      .send({ kind: 'other', terms: ['a', 'b'] })
      .expect(401);
  });
});
