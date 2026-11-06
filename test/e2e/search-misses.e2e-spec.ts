import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, shopper, staff } = shop;
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 40 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25));
};
const misses = async () =>
  (await http.get('/admin/search-misses').set('Authorization', staff.auth).expect(200)).body.misses;

describe('searches that found nothing', () => {
  it('counts each missed search once per time, folded, and lists the most frequent first for staff', async () => {
    for (const q of ['Zettai Ryōiki', 'zettai ryoiki', 'Blue Lock', 'rem'])
      await http.get(`/products?q=${encodeURIComponent(q)}`);
    await until(async () => (await misses()).length === 2);
    expect((await misses()).map((m: any) => [m.query, m.times])).toEqual([
      ['zettai ryoiki', 2],
      ['blue lock', 1],
    ]); // "rem" found the Rem figure: not a miss
  });

  it("doesn't keep searches that look like an email address or a phone number, or page 2 of anything", async () => {
    await http.get('/products?q=someone%40example.com');
    await http.get('/products?q=403%20555%200100');
    await http.get('/products?q=nothing%20here&cursor=24');
    await http.get('/products/suggest?q=typing%20along'); // suggestions while typing are not searches
    await new Promise((r) => setTimeout(r, 150));
    expect((await misses()).map((m: any) => m.query)).toEqual(['zettai ryoiki', 'blue lock']);
  });

  it('lets staff dismiss a search once it is handled, and keeps the list from shoppers', async () => {
    await http.get('/admin/search-misses').set('Authorization', shopper.auth).expect(403);
    await http
      .delete('/admin/search-misses?query=blue%20lock')
      .set('Authorization', staff.auth)
      .expect(200);
    await http
      .delete('/admin/search-misses?query=blue%20lock')
      .set('Authorization', staff.auth)
      .expect(404);
    expect((await misses()).map((m: any) => m.query)).toEqual(['zettai ryoiki']);
    await http.get('/admin/search-misses?days=0').set('Authorization', staff.auth).expect(400);
  });
});
