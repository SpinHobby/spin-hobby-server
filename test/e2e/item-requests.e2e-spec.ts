import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(() => shop.close());
const { http, staff, shopper } = shop;
const asStaff = { Authorization: staff.auth };

const products = (await http.get('/products?limit=100').expect(200)).body.items as {
  id: string;
  status: string;
  name: string;
}[];
const sold = products.find((p) => p.status === 'out');
const inStock = products.find((p) => p.status === 'in' || p.status === 'low');

describe('"Ask us to find one" on sold items', () => {
  it('has a sold item and one in stock to test with', () => {
    expect(sold).toBeTruthy();
    expect(inStock).toBeTruthy();
  });

  it('takes a request for a sold item, once per person, and not for an item in stock', async () => {
    await http
      .post('/requests')
      .send({ productId: sold!.id, email: 'ana@example.com', note: 'Boxed only' })
      .expect(200);
    await http
      .post('/requests')
      .send({ productId: sold!.id, email: 'ANA@example.com' })
      .expect(200);
    await http
      .post('/requests')
      .send({ productId: sold!.id, email: 'ben@example.com' })
      .expect(200);
    await http
      .post('/requests')
      .send({ productId: inStock!.id, email: 'ana@example.com' })
      .expect(400);
    await http.post('/requests').send({ productId: 'nope', email: 'ana@example.com' }).expect(404);
    await http.post('/requests').send({ productId: sold!.id, email: 'not-an-email' }).expect(400);
  });

  it('shows staff the requests counted per item, and not shoppers', async () => {
    const listed = (await http.get('/admin/requests').set(asStaff).expect(200)).body;
    expect(listed.waiting).toBe(2);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ productId: sold!.id, name: sold!.name, count: 2 });
    expect(listed.items[0].requests.map((r: { email: string }) => r.email).sort()).toEqual([
      'ana@example.com',
      'ben@example.com',
    ]);
    expect(
      listed.items[0].requests.find((r: { email: string }) => r.email === 'ana@example.com').note,
    ).toBe('Boxed only');
    await http.get('/admin/requests').set({ Authorization: shopper.auth }).expect(403);
  });

  it('answers everyone waiting, closes the requests, and refuses a listing that cannot be bought', async () => {
    // "found" must point at something a shopper can buy: the sold listing itself cannot be
    await http
      .post(`/admin/requests/${sold!.id}/answer`)
      .set(asStaff)
      .send({ found: true, message: 'One more arrived.' })
      .expect(400);
    const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
    try {
      await answerAll(mail);
    } finally {
      mail.restore();
    }
  });

  const answerAll = async (mail: ReturnType<typeof mockFetch>) => {
    const answered = await http
      .post(`/admin/requests/${sold!.id}/answer`)
      .set(asStaff)
      .send({ found: true, message: 'One more arrived.', buyProductId: inStock!.id })
      .expect(200);
    expect(answered.body.sent).toBe(2);
    expect(mail.calls).toHaveLength(2);
    expect(mail.calls[0].body).toMatchObject({ subject: `We found one: ${sold!.name}` });
    expect(String((mail.calls[0].body as { html: string }).html)).toContain('One more arrived.');
    expect((await http.get('/admin/requests').set(asStaff).expect(200)).body.items).toEqual([]);
    // nothing waits any more
    await http
      .post(`/admin/requests/${sold!.id}/answer`)
      .set(asStaff)
      .send({ found: false })
      .expect(404);
    // the same person can ask again later
    await http
      .post('/requests')
      .send({ productId: sold!.id, email: 'ana@example.com' })
      .expect(200);
    const again = await http
      .post(`/admin/requests/${sold!.id}/answer`)
      .set(asStaff)
      .send({ found: false, message: 'The maker stopped making it.' })
      .expect(200);
    expect(again.body.sent).toBe(1);
    expect(mail.calls[2].body).toMatchObject({ subject: `About your request: ${sold!.name}` });
  };

  it('puts recently sold items on the home page', async () => {
    const home = (await http.get('/homepage').expect(200)).body;
    expect(Array.isArray(home.recentlySold)).toBe(true);
    for (const p of home.recentlySold) expect(p.status).toBe('out');
  });
});
