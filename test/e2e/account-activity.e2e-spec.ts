import { afterAll, describe, expect, it } from 'vitest';
import { placeSampleOrders, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite, owner, staff, shopper } = shop;
await placeSampleOrders(shop); // one order signed in, one as a guest with the same email

const activity = (id: string, who = owner) =>
  http.get(`/admin/accounts/${id}/activity`).set('Authorization', who.auth);

describe('admin account activity', () => {
  it('is for owners only', async () => {
    await http.get(`/admin/accounts/${shopper.id}/activity`).expect(401);
    await activity(shopper.id, staff).expect(403);
    await activity(shopper.id, shopper).expect(403);
    await activity('00000000-0000-4000-8000-000000000000').expect(404);
  });

  it("shows the account's orders (guest ones with its email too), favourites, addresses and alerts", async () => {
    await pglite.query(
      "insert into public.wishlist_items (user_id, square_item_id) values ($1, 'FIG1'), ($1, 'PRZ1')",
      [shopper.id],
    );
    await pglite.query(
      `insert into public.customer_addresses (user_id, first_name, last_name, address1, city, province, postal_code, country, phone, is_default)
       values ($1, 'Fan', 'Person', '1 Main St', 'Calgary', 'AB', 'T2P 1J9', 'CA', '+1 555 0100', true)`,
      [shopper.id],
    );
    await pglite.query(
      "insert into public.stock_alerts (email, square_variation_id, user_id) values ('fan@example.com', 'FIG1_V', $1)",
      [shopper.id],
    );
    const paid = await pglite.query<{ id: number; total_cents: number }>(
      'select id, total_cents from public.orders where user_id = $1',
      [shopper.id],
    );
    await pglite.query(
      "insert into public.order_events (order_id, event_type, data) values ($1, 'refunded', '{\"amount_cents\": 300}')",
      [paid.rows[0].id],
    );

    const body = (await activity(shopper.id).expect(200)).body;
    expect(body.orders).toHaveLength(2);
    expect(body.orders.map((o: any) => o.guest).sort()).toEqual([false, true]);
    const signedIn = body.orders.find((o: any) => !o.guest);
    expect(signedIn.items[0]).toMatchObject({ quantity: 1, name: expect.any(String) });
    expect(signedIn.events.map((e: any) => e.type)).toContain('refunded');
    expect(signedIn.refunded_cents).toBe(300);

    expect(body.favourites.map((f: any) => f.id).sort()).toEqual(['FIG1', 'PRZ1']);
    expect(body.addresses).toEqual([
      expect.objectContaining({ city: 'Calgary', is_default: true }),
    ]);
    expect(body.phone).toBe('+1 555 0100');
    expect(body.alerts).toEqual([
      expect.objectContaining({ product_id: 'FIG1', notified_at: null }),
    ]);
    expect(body.summary).toMatchObject({ orders: 2, favourites: 2, alertsWaiting: 1, refunds: 1 });
  });

  it('is empty, not an error, for an account that has done nothing', async () => {
    const body = (await activity(staff.id).expect(200)).body;
    expect(body).toMatchObject({
      orders: [],
      favourites: [],
      addresses: [],
      alerts: [],
      phone: null,
    });
    expect(body.summary).toMatchObject({ orders: 0, netSpentCents: 0, firstOrderAt: null });
  });
});
