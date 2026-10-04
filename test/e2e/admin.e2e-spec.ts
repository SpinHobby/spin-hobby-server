import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { future, placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff, shopper } = shop;
await placeSampleOrders(shop);
await pglite.query(
  "update public.inventory_snapshots set quantity = 7 where square_variation_id = 'BDG1_V'",
); // the badge set has been restocked
await http.post('/alerts').send({ email: 'guest@example.com', variationId: 'BDG1_V' }).expect(200); // one shopper waiting for the sold-out badge set

describe('admin', () => {
  it('is closed to customers and anonymous callers', async () => {
    await http.get('/admin/dashboard').expect(401);
    await http
      .get('/admin/dashboard')
      .set('Authorization', shopper.auth)
      .expect(403, { success: false, error: 'You do not have permission to perform this action.' });
  });

  it('summarises the dashboard', async () => {
    const res = await http.get('/admin/dashboard').set('Authorization', staff.auth).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      toShip: 1,
      openPreorders: 1,
      reservedUnits: 1,
      alertsWaiting: 1,
      preorderProducts: 1,
      ordersToday: 2,
    });
    expect(res.body.lowStockList.map((p: any) => p.id).sort()).toEqual(['CHB1']);
    expect(res.body.closingPreorders.map((p: any) => p.id)).toEqual(['FIG1']);
    expect(res.body.salesTodayCents).toBeGreaterThan(0);
  });

  it('lists products with admin-only fields and edits storefront metadata', async () => {
    await pglite.query(
      "insert into public.stock_alerts (email, square_variation_id) values ('wait@example.com', 'CHB1_V')",
    );
    const list = (
      await http.get('/admin/products?limit=60').set('Authorization', staff.auth).expect(200)
    ).body.items;
    expect(list.find((p: any) => p.id === 'FIG1')).toMatchObject({
      janCode: '4580000000001',
      availability: 'preorder',
      isFeatured: true,
      sortOrder: 0,
    });
    expect(list.find((p: any) => p.id === 'CHB1').alertsWaiting).toBe(1);
    expect(
      (
        await http.get('/admin/products?filter=featured').set('Authorization', staff.auth)
      ).body.items.map((p: any) => p.id),
    ).toEqual(['FIG1']);

    await http
      .patch('/admin/products/PRZ1')
      .set('Authorization', staff.auth)
      .send({ availability: 'bogus' })
      .expect(400, { success: false, error: 'Invalid availability.' });
    await http
      .patch('/admin/products/PRZ1')
      .set('Authorization', staff.auth)
      .send({ max_per_customer: -1 })
      .expect(400);
    const updated = await http
      .patch('/admin/products/PRZ1')
      .set('Authorization', staff.auth)
      .send({
        availability: 'preorder',
        order_by_date: future(10),
        release_month: '2027-01-01',
        compare_at_cents: 4500,
        is_featured: true,
        sort_order: 2,
        jan_code: '',
      })
      .expect(200);
    expect(updated.body.product).toMatchObject({
      availability: 'preorder',
      compare_at_cents: 4500,
      is_featured: true,
      sort_order: 2,
      jan_code: null,
    });
    expect((await http.get('/square/catalog/PRZ1')).body.item).toMatchObject({
      status: 'pre',
      compareAtCents: 4500,
      releaseMonth: '2027-01-01',
    });
    const log = await pglite.query<any>(
      "select action, target from public.admin_logs where action = 'product.updated'",
    );
    expect(log.rows).toEqual([{ action: 'product.updated', target: 'PRZ1' }]);
    await http
      .patch('/admin/products/PRZ1')
      .set('Authorization', staff.auth)
      .send({ availability: 'auto', order_by_date: '', release_month: '' })
      .expect(200);
    await http.patch('/admin/products/NOPE').set('Authorization', staff.auth).send({}).expect(404);
  });

  it('emails restock alerts', async () => {
    const email = mockFetch({ 'api.resend.com': () => ({ id: 'email-1' }) });
    try {
      const res = await http
        .post('/admin/products/CHB1/notify-restock')
        .set('Authorization', staff.auth)
        .expect(200);
      expect(res.body.sent).toBe(1);
      expect(email.calls[0].body).toMatchObject({
        to: ['wait@example.com'],
        subject: 'Chibi Figure is back at Spin Hobby',
      });
      expect(
        (await http.post('/admin/products/CHB1/notify-restock').set('Authorization', staff.auth))
          .body.sent,
      ).toBe(0);
    } finally {
      email.restore();
    }
  });

  it('ships, refunds and prints orders', async () => {
    const orders = (
      await http.get('/admin/orders?status=paid').set('Authorization', staff.auth).expect(200)
    ).body;
    expect(orders.total).toBe(1);
    const order = orders.items[0];
    expect(order.order_items).toEqual([
      expect.objectContaining({ name: 'Miku Prize Figure', quantity: 1 }),
    ]);
    await http.get('/admin/orders?status=bogus').set('Authorization', staff.auth).expect(400);

    const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
    try {
      await http
        .post(`/admin/orders/${order.id}/ship`)
        .set('Authorization', staff.auth)
        .send({})
        .expect(400, { success: false, error: 'trackingNumber is required.' });
      const shipped = await http
        .post(`/admin/orders/${order.id}/ship`)
        .set('Authorization', staff.auth)
        .send({ trackingNumber: 'CP123', carrier: 'Canada Post' })
        .expect(200);
      expect(shipped.body).toEqual({ success: true, customerEmailed: true });
      expect(mail.calls[0].body.to).toEqual(['fan@example.com']);
      await http
        .post(`/admin/orders/${order.id}/ship`)
        .set('Authorization', staff.auth)
        .send({ trackingNumber: 'CP123' })
        .expect(400, { success: false, error: 'Only paid orders can be shipped.' });
    } finally {
      mail.restore();
    }

    const slip = await http
      .get(`/admin/orders/${order.id}/packing-slip`)
      .set('Authorization', staff.auth)
      .expect(200);
    expect(slip.body.html).toContain('Aki Tanaka');
    expect(slip.body.html).toContain('Miku Prize Figure');

    await http
      .post(`/admin/orders/${order.id}/refund`)
      .set('Authorization', staff.auth)
      .send({})
      .expect(403);
    const paypal = mockFetch({
      '/v1/oauth2/token': () => ({ access_token: 'tok' }),
      '/refund': () => ({ id: 'R1', status: 'COMPLETED' }),
    });
    try {
      const refunded = await http
        .post(`/admin/orders/${order.id}/refund`)
        .set('Authorization', owner.auth)
        .send({})
        .expect(200);
      expect(refunded.body.status).toBe('refunded');
      expect(
        paypal.calls.find((c) => c.url.includes('/captures/CAP-1/refund'))!.body.amount.value,
      ).toBe((order.total_cents / 100).toFixed(2));
    } finally {
      paypal.restore();
    }
    const detail = (
      await http.get(`/admin/orders/${order.id}`).set('Authorization', staff.auth).expect(200)
    ).body.order;
    expect(detail.order_events.map((e: any) => e.event_type)).toEqual([
      'created',
      'paid',
      'shipped',
      'refunded',
    ]);
  });

  it('keeps settings and tax rates owner-only and validated', async () => {
    await http
      .put('/admin/settings')
      .set('Authorization', staff.auth)
      .send({ low_stock_threshold: 5 })
      .expect(403);
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ handling_days_min: 5, handling_days_max: 3 })
      .expect(400);
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ payment_provider: 'stripe' })
      .expect(400);
    const saved = await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ free_shipping_threshold_cents: 10000, fx_cad_usd: 0.7 })
      .expect(200);
    expect(saved.body.settings).toMatchObject({
      free_shipping_threshold_cents: 10000,
      fx_cad_usd: 0.7,
    });
    expect((await http.get('/checkout/config')).body).toMatchObject({
      freeShippingThresholdCents: 10000,
      fxCadUsd: 0.7,
    });
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ free_shipping_threshold_cents: 7500, fx_cad_usd: 0.73 })
      .expect(200);

    await http.get('/admin/tax-rates').set('Authorization', staff.auth).expect(403);
    const tax = await http
      .put('/admin/tax-rates')
      .set('Authorization', owner.auth)
      .send({ country: 'US', province: 'wa', rate: 0.065 })
      .expect(200);
    expect(tax.body.taxRate).toMatchObject({
      country: 'US',
      province: 'WA',
      rate: 0.065,
      enabled: true,
    });
  });

  it('manages hero slides and events end to end', async () => {
    const a = (
      await http
        .post('/admin/homepage/slides')
        .set('Authorization', staff.auth)
        .send({ headline: 'First', isVisible: true })
        .expect(200)
    ).body.slide;
    const b = (
      await http
        .post('/admin/homepage/slides')
        .set('Authorization', staff.auth)
        .send({ headline: 'Second', subheading: 'Sub', isVisible: false, sortOrder: 1 })
        .expect(200)
    ).body.slide;
    await http
      .put(`/admin/homepage/slides/${b.id}`)
      .set('Authorization', staff.auth)
      .send({ isVisible: true, linkUrl: 'https://spinhobby.com/sale' })
      .expect(200);
    await http
      .put('/admin/homepage/slides/reorder')
      .set('Authorization', staff.auth)
      .send({ ids: [b.id, a.id] })
      .expect(200);
    expect(
      (await http.get('/homepage')).body.slides.map((s: any) => [s.headline, s.link_url]),
    ).toEqual([
      ['Second', 'https://spinhobby.com/sale'],
      ['First', null],
    ]);
    await http
      .put('/admin/homepage/slides/not-a-uuid')
      .set('Authorization', staff.auth)
      .send({})
      .expect(400);
    await http
      .delete(`/admin/homepage/slides/${a.id}`)
      .set('Authorization', staff.auth)
      .expect(200);
    expect(
      (await http.get('/admin/homepage/slides').set('Authorization', staff.auth)).body.slides,
    ).toHaveLength(1);

    const ev = (
      await http
        .post('/admin/events')
        .set('Authorization', staff.auth)
        .send({ name: 'Otafest', city: 'Calgary', startDate: '2027-05-15', endDate: '2027-05-17' })
        .expect(200)
    ).body.event;
    expect(ev).toMatchObject({
      name: 'Otafest',
      city: 'Calgary',
      start_date: '2027-05-15',
      end_date: '2027-05-17',
      is_visible: true,
    });
    await http
      .put(`/admin/events/${ev.id}`)
      .set('Authorization', staff.auth)
      .send({ name: 'Otafest 2027', startDate: '2027-05-15', endDate: '2027-05-10' })
      .expect(400, { success: false, error: 'End date must be on or after the start date.' });
    await http
      .post('/admin/events')
      .set('Authorization', staff.auth)
      .send({ name: 'Bad', startDate: 'soon' })
      .expect(400);
    const fixed = await http
      .put(`/admin/events/${ev.id}`)
      .set('Authorization', staff.auth)
      .send({ name: 'Otafest 2027', city: 'Calgary' })
      .expect(200);
    expect(fixed.body.event.name).toBe('Otafest 2027');
    expect((await http.get('/homepage')).body.events.map((e: any) => e.name)).toEqual([
      'Otafest 2027',
    ]);
    await http.delete(`/admin/events/${ev.id}`).set('Authorization', staff.auth).expect(200);
  });
});
