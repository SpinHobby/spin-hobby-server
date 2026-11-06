import { afterAll, describe, expect, it } from 'vitest';
import { placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, shopper, staff, owner } = shop;
await placeSampleOrders(shop); // the shopper's paid Miku Prize Figure (PRZ1), and a guest's reserved Rem pre-order (FIG1)
const order = async (item: string) =>
  (
    await pglite.query<{ id: number; status: string }>(
      `select o.id, o.status from public.orders o join public.order_items i on i.order_id = o.id
        where i.square_item_id = $1 and o.status <> 'pending'`,
      [item],
    )
  ).rows[0];

const review = {
  itemId: 'PRZ1',
  rating: 5,
  title: 'Lovely',
  body: 'Paint is clean, box arrived safe.',
  name: 'Fan',
};

describe('product reviews', () => {
  it('lets a signed-in buyer review what they bought, once, and shows nothing until staff approve it', async () => {
    const res = await http
      .post('/reviews')
      .set('Authorization', shopper.auth)
      .send(review)
      .expect(200);
    expect(res.body.review.status).toBe('pending');
    expect((await http.get('/products/PRZ1/reviews').expect(200)).body).toMatchObject({
      summary: { count: 0, average: null },
      items: [],
    });
    const again = await http
      .post('/reviews')
      .set('Authorization', shopper.auth)
      .send(review)
      .expect(404);
    expect(again.body.error).toMatch(/reviewed it already/);
  });

  it("refuses someone who didn't buy it, and a guest with a wrong email the same as a wrong number", async () => {
    await http.post('/reviews').set('Authorization', owner.auth).send(review).expect(404);
    await http.post('/reviews').send(review).expect(400);
    const { id } = await order('PRZ1');
    const wrongEmail = await http
      .post('/reviews')
      .send({ ...review, orderId: id, email: 'x@y.com' })
      .expect(404);
    const wrongNumber = await http
      .post('/reviews')
      .send({ ...review, orderId: 99999, email: 'fan@example.com' })
      .expect(404);
    expect(wrongEmail.body).toEqual(wrongNumber.body);
    await http
      .post('/reviews')
      .send({ ...review, rating: 6 })
      .expect(400);
  });

  it("doesn't take a review of a pre-order that hasn't arrived", async () => {
    const { id, status } = await order('FIG1');
    expect(status).toBe('preorder_reserved');
    await http
      .post('/reviews')
      .send({ ...review, itemId: 'FIG1', orderId: id, email: 'FAN@example.com' })
      .expect(404);
  });

  it('staff approve and answer; the shop then shows the review with its stars, and no buyer details', async () => {
    await http.get('/admin/reviews').set('Authorization', shopper.auth).expect(403);
    const waiting = (await http.get('/admin/reviews').set('Authorization', staff.auth).expect(200))
      .body;
    expect(waiting.pendingCount).toBe(1);
    expect(waiting.reviews[0]).toMatchObject({
      productName: 'Miku Prize Figure',
      email: 'fan@example.com',
      rating: 5,
    });

    await http
      .put(`/admin/reviews/${waiting.reviews[0].id}`)
      .set('Authorization', staff.auth)
      .send({ status: 'approved', reply: 'Thank you!' })
      .expect(200);
    const shown = (await http.get('/products/PRZ1/reviews').expect(200)).body;
    expect(shown.summary).toEqual({ count: 1, average: 5, stars: [1, 0, 0, 0, 0] });
    expect(shown.items[0]).toMatchObject({
      authorName: 'Fan',
      title: 'Lovely',
      reply: 'Thank you!',
    });
    const text = JSON.stringify(shown);
    for (const secret of ['fan@example.com', 'orderId', 'userId'])
      expect(text).not.toContain(secret);

    await http
      .put(`/admin/reviews/${waiting.reviews[0].id}`)
      .set('Authorization', staff.auth)
      .send({ status: 'rejected' })
      .expect(200);
    expect((await http.get('/products/PRZ1/reviews').expect(200)).body.summary.count).toBe(0);
    expect(
      (await http.get('/admin/reviews?status=nope').set('Authorization', staff.auth)).status,
    ).toBe(400);
  });
});
