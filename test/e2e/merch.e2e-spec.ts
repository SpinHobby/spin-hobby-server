import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { address, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff, shopper } = shop;

describe('hand-entered merchandise', () => {
  let itemId = '';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('uploads a resized photo to the public bucket', async () => {
    const storage = mockFetch({ '/storage/v1/object/product-images/': () => ({ Key: 'ok' }) });
    try {
      await http
        .post('/admin/uploads')
        .set('Authorization', shopper.auth)
        .send({ data: png.toString('base64'), contentType: 'image/png' })
        .expect(403);
      await http
        .post('/admin/uploads')
        .set('Authorization', staff.auth)
        .send({ data: png.toString('base64'), contentType: 'image/gif' })
        .expect(400, { success: false, error: 'Upload a WebP, JPEG or PNG image.' });
      const res = await http
        .post('/admin/uploads')
        .set('Authorization', staff.auth)
        .send({
          data: `data:image/png;base64,${png.toString('base64')}`,
          contentType: 'image/png',
          folder: 'products',
        })
        .expect(200);
      expect(res.body.url).toMatch(
        /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/product-images\/products\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/,
      );
      expect(res.body.bytes).toBe(png.length);
      expect(storage.calls[0].url).toContain('/storage/v1/object/product-images/products/');
    } finally {
      storage.restore();
    }
  });

  it('creates a product that shows up in the storefront with stock and photos', async () => {
    await http
      .post('/admin/products')
      .set('Authorization', staff.auth)
      .send({ name: 'Keychain', priceCents: 0 })
      .expect(400, { success: false, error: 'Enter a price above $0.' });
    await http
      .post('/admin/products')
      .set('Authorization', staff.auth)
      .send({ name: 'Keychain', priceCents: 900, stockCount: -1 })
      .expect(400);
    await http
      .post('/admin/products')
      .set('Authorization', staff.auth)
      .send({ name: 'Keychain', priceCents: 900, availability: 'preorder' })
      .expect(400, { success: false, error: 'Pre-orders need an order-by date.' });
    await http
      .post('/admin/products')
      .set('Authorization', staff.auth)
      .send({ name: 'Keychain', priceCents: 900, imageUrls: ['http://insecure/img.png'] })
      .expect(400);
    const res = await http
      .post('/admin/products')
      .set('Authorization', staff.auth)
      .send({
        name: 'Acrylic Keychain — Con Exclusive',
        category: 'Keychains',
        priceCents: 1400,
        stockCount: 12,
        series: 'Spin Hobby Originals',
        description: 'Double-sided, 6cm.',
        imageUrls: [
          'https://proj.supabase.co/storage/v1/object/public/product-images/products/a.webp',
          'https://proj.supabase.co/b.webp',
        ],
      })
      .expect(200);
    itemId = res.body.product.id;
    expect(itemId).toMatch(/^manual-/);
    expect(res.body.product).toMatchObject({
      name: 'Acrylic Keychain — Con Exclusive',
      category: 'Keychains',
      priceCents: 1400,
      stockCount: 12,
      status: 'in',
      series: 'Spin Hobby Originals',
      source: 'manual',
    });
    expect(res.body.product.images).toHaveLength(2);
    expect((await http.get(`/square/catalog/${itemId}`)).body.item.description).toBe(
      'Double-sided, 6cm.',
    );
    const listed = (await http.get('/products?category=Keychains')).body.items;
    expect(listed.map((p: any) => p.id)).toEqual([itemId]);
    const admin = (
      await http.get('/admin/products?limit=60').set('Authorization', staff.auth)
    ).body.items.find((p: any) => p.id === itemId);
    expect(admin).toMatchObject({ source: 'manual' });
    expect(
      (await http.get('/admin/products?limit=60').set('Authorization', staff.auth)).body.items.find(
        (p: any) => p.id === 'PRZ1',
      ).source,
    ).toBe('square');
    const quote = await http
      .post('/cart/quote')
      .send({
        items: [{ variationId: `${itemId}-v`, quantity: 13 }],
        shippingMethod: 'standard',
        country: 'CA',
        province: 'AB',
      })
      .expect(200);
    expect(quote.body.warnings[0]).toMatchObject({ code: 'QTY_REDUCED' });
    expect(quote.body.lines[0]).toMatchObject({ quantity: 12, unitPriceCents: 1400 });
  });

  it('edits stock, price and photos, but only for hand-entered products', async () => {
    await http
      .patch('/admin/products/PRZ1/catalog')
      .set('Authorization', staff.auth)
      .send({ stockCount: 3 })
      .expect(400, {
        success: false,
        error: 'This product comes from Square. Edit its name, price, photos and stock in Square.',
      });
    await http
      .patch(`/admin/products/${itemId}/catalog`)
      .set('Authorization', staff.auth)
      .send({
        stockCount: 2,
        priceCents: 1500,
        name: 'Acrylic Keychain',
        imageUrls: ['https://proj.supabase.co/c.webp'],
      })
      .expect(200);
    let item = (await http.get(`/square/catalog/${itemId}`)).body.item;
    expect(item).toMatchObject({
      name: 'Acrylic Keychain',
      priceCents: 1500,
      stockCount: 2,
      status: 'low',
      images: ['https://proj.supabase.co/c.webp'],
    });
    await http
      .patch(`/admin/products/${itemId}/catalog`)
      .set('Authorization', staff.auth)
      .send({ stockCount: null })
      .expect(200);
    item = (await http.get(`/square/catalog/${itemId}`)).body.item;
    expect(item).toMatchObject({ stockCount: null, status: 'in' });
    await http
      .patch(`/admin/products/${itemId}/catalog`)
      .set('Authorization', staff.auth)
      .send({ stockCount: 2 })
      .expect(200);
    // Storefront metadata edits (featured, sale price) work on manual products too.
    await http
      .patch(`/admin/products/${itemId}`)
      .set('Authorization', staff.auth)
      .send({ compare_at_cents: 2000, is_featured: true })
      .expect(200);
    expect((await http.get(`/square/catalog/${itemId}`)).body.item.compareAtCents).toBe(2000);
  });

  it('sends manual products to Square checkout as named line items', async () => {
    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ payment_provider: 'square' })
      .expect(200);
    const square = mockFetch({
      '/v2/orders': () => ({ order: { id: 'SQ-ORDER-2' } }),
      '/v2/payments': () => ({ payment: { id: 'SQ-PAY-2', status: 'COMPLETED' } }),
    });
    try {
      const intent = await http
        .post('/checkout/intent')
        .send({
          quote: {
            items: [
              { variationId: `${itemId}-v`, quantity: 1 },
              { variationId: 'PRZ1_V', quantity: 1 },
            ],
            shippingMethod: 'standard',
            country: 'CA',
            province: 'AB',
          },
          email: 'con@example.com',
          billing: address,
          shipping: address,
        })
        .expect(200);
      await http
        .post('/square/payments')
        .send({ orderId: intent.body.orderId, email: 'con@example.com', sourceId: 'cnon:ok' })
        .expect(200);
      const lines = square.calls.find((c) => c.url.endsWith('/v2/orders'))!.body.order.line_items;
      expect(lines.find((l: any) => l.name === 'Acrylic Keychain')).not.toHaveProperty(
        'catalog_object_id',
      );
      expect(lines.find((l: any) => l.name === 'Miku Prize Figure')).toHaveProperty(
        'catalog_object_id',
        'PRZ1_V',
      );
    } finally {
      square.restore();
      await http
        .put('/admin/settings')
        .set('Authorization', owner.auth)
        .send({ payment_provider: 'paypal' })
        .expect(200);
    }
  });

  it('archives hand-entered products and refuses to archive Square ones', async () => {
    await http.delete('/admin/products/PRZ1').set('Authorization', staff.auth).expect(400);
    await http.delete(`/admin/products/${itemId}`).set('Authorization', staff.auth).expect(200);
    expect((await http.get('/products?category=Keychains')).body.items).toEqual([]);
  });
});
