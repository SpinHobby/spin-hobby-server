import { afterAll, describe, expect, it } from 'vitest';
import { seedProduct } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, pglite } = shop;

// a Square "variable price" item: no price online
await seedProduct(pglite, {
  id: 'VAR1',
  name: 'Asuka Figure',
  category: 'Figures',
  priceCents: 0,
  stock: 1,
});

describe('products with no online price', () => {
  it('are never priced into a cart or an order', async () => {
    const quote = await http
      .post('/cart/quote')
      .send({
        items: [{ variationId: 'VAR1_V', quantity: 1 }],
        shippingMethod: 'standard',
        country: 'CA',
        province: 'AB',
      })
      .expect(200);
    expect(quote.body.lines).toEqual([]);
    expect(quote.body.warnings).toEqual([
      {
        variationId: 'VAR1_V',
        code: 'NO_PRICE',
        message: 'Asuka Figure has no online price yet. Contact us to buy it.',
      },
    ]);
    const intent = await http
      .post('/checkout/intent')
      .send({
        quote: {
          items: [{ variationId: 'VAR1_V', quantity: 1 }],
          shippingMethod: 'standard',
          country: 'CA',
          province: 'AB',
        },
        email: 'free@example.com',
        billing: address,
        shipping: address,
      })
      .expect(409);
    expect(JSON.stringify(intent.body)).toContain('NO_PRICE');
    const orders = await pglite.query(
      "select 1 from public.orders where billing_email = 'free@example.com'",
    );
    expect(orders.rows).toHaveLength(0);
  });

  it('are left out of suggestions', async () => {
    const addOns = (await http.get('/products/add-ons').expect(200)).body.items.map(
      (p: { id: string }) => p.id,
    );
    expect(addOns).not.toContain('VAR1');
  });
});

describe('product links in lower case', () => {
  it('find the product whatever the case of its id', async () => {
    const upper = (await http.get('/square/catalog/PRZ1').expect(200)).body.item;
    const lower = (await http.get('/square/catalog/prz1').expect(200)).body.item;
    expect(lower.id).toBe('PRZ1');
    expect(lower).toEqual(upper);
    await http.get('/square/catalog/nope').expect(404);
  });
});
