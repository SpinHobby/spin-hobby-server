import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite } = shop;

describe('webhooks', () => {
  const sign = (raw: string) =>
    createHmac('sha256', 'whsec')
      .update('https://api.spinhobby.com/webhooks/square' + raw)
      .digest('base64');

  it('verifies Square signatures, applies IN_STOCK counts, and ignores duplicates', async () => {
    const event = JSON.stringify({
      event_id: 'evt-1',
      type: 'inventory.count.updated',
      created_at: new Date().toISOString(),
      data: {
        object: {
          inventory_counts: [
            { catalog_object_id: 'BDG1_V', state: 'IN_STOCK', quantity: '7' },
            { catalog_object_id: 'BDG1_V', state: 'SOLD', quantity: '99' },
            { catalog_object_id: 'UNKNOWN_V', state: 'IN_STOCK', quantity: '3' },
          ],
        },
      },
    });
    await http
      .post('/webhooks/square')
      .set('Content-Type', 'application/json')
      .set('x-square-hmacsha256-signature', 'bad')
      .send(event)
      .expect(401);
    await http
      .post('/webhooks/square')
      .set('Content-Type', 'application/json')
      .set('x-square-hmacsha256-signature', sign(event))
      .send(event)
      .expect(200, { success: true });
    await http
      .post('/webhooks/square')
      .set('Content-Type', 'application/json')
      .set('x-square-hmacsha256-signature', sign(event))
      .send(event)
      .expect(200, { success: true, duplicate: true });
    const stock = await pglite.query<any>(
      "select quantity from public.inventory_snapshots where square_variation_id = 'BDG1_V'",
    );
    expect(stock.rows[0].quantity).toBe(7);
    expect((await http.get('/products?q=Can%20Badge')).body.items[0].status).toBe('in');
  });
});
