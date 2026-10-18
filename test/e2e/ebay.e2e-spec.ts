import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inventoryEvents } from '../../src/common/inventory-events.js';
import { SquareCatalogClient } from '../../src/integrations/square/square-catalog.client.js';
import { SquarePhotosService } from '../../src/modules/admin/products/square-photos.service.js';
import { EbaySyncService } from '../../src/modules/ebay/ebay-sync.service.js';
import { EbayListingsService } from '../../src/modules/ebay/ebay-listings.service.js';
import { PhotoBackgroundsService } from '../../src/modules/admin/products/photo-backgrounds.service.js';
import { mockFetch } from '../support/harness.js';
import { startShop } from '../support/shop.js';

Object.assign(process.env, {
  EBAY_CLIENT_ID: 'SpinHobb-shop-SBX-123',
  EBAY_CLIENT_SECRET: 'SBX-secret',
  EBAY_RU_NAME: 'Spin_Hobby-SpinHobb-shop-abcdef',
  EBAY_ENVIRONMENT: 'sandbox',
  EBAY_TOKEN_KEY: 'a test key that is long enough to be a key',
  EBAY_ADMIN_RETURN_URL: 'https://shop.example/admin',
  EBAY_VERIFICATION_TOKEN: 'verification_token_for_tests_0123456789',
  EBAY_DELETION_ENDPOINT: 'https://api.shop.example/ebay/account-deletion',
});

const shop = await startShop();
const { http, owner, staff, pglite } = shop;
const asOwner = { Authorization: owner.auth };
const asStaff = { Authorization: staff.auth };
const square = shop.app.get(SquareCatalogClient);
const photos = shop.app.get(SquarePhotosService);
const sync = shop.app.get(EbaySyncService);

/** eBay stands in: what each call answers, and what was sent to it. */
const sent: { method: string; url: string; body: unknown }[] = [];
let orders: unknown[] = [];
let quantityAnswer: (sku: string) => {
  statusCode: number;
  errors?: { message: string }[];
} = () => ({ statusCode: 200 });
const body = (init: RequestInit | undefined) =>
  typeof init?.body === 'string'
    ? init.body.startsWith('{')
      ? JSON.parse(init.body)
      : init.body
    : undefined;
const inventoryItems = new Map<string, unknown>();
const ebay = mockFetch({
  'https://api.sandbox.ebay.com/identity/v1/oauth2/token': (init) => {
    sent.push({ method: 'POST', url: 'token', body: body(init) });
    return {
      access_token: 'user-access-token',
      expires_in: 7200,
      refresh_token: 'user-refresh-token',
      refresh_token_expires_in: 47304000,
    };
  },
  'https://apiz.sandbox.ebay.com/commerce/identity/v1/user/': () => ({
    username: 'spinhobby_seller',
  }),
  'https://api.sandbox.ebay.com/sell/account/v1/fulfillment_policy': () => ({
    fulfillmentPolicies: [{ fulfillmentPolicyId: 'F1', name: 'Canada Post' }],
  }),
  'https://api.sandbox.ebay.com/sell/account/v1/payment_policy': () => ({
    paymentPolicies: [{ paymentPolicyId: 'P1', name: 'Managed payments' }],
  }),
  'https://api.sandbox.ebay.com/sell/account/v1/return_policy': () => ({
    returnPolicies: [{ returnPolicyId: 'R1', name: '30 days' }],
  }),
  'https://api.sandbox.ebay.com/sell/inventory/v1/location': (init, url) => {
    if (init?.method === 'POST') {
      sent.push({ method: 'POST', url, body: body(init) });
      return new Response(null, { status: 204 });
    }
    return {
      locations: [
        {
          merchantLocationKey: 'store',
          name: 'Store',
          location: { address: { city: 'Toronto', stateOrProvince: 'ON', country: 'CA' } },
        },
      ],
    };
  },
  'https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/': (init, url) => {
    // eBay gives back the item as it was last written
    if ((init?.method ?? 'GET') === 'GET') {
      const last = inventoryItems.get(url);
      return last ? { sku: url.split('/').pop(), ...last } : new Response(null, { status: 404 });
    }
    inventoryItems.set(url, body(init));
    sent.push({ method: 'PUT', url, body: body(init) });
    return new Response(null, { status: 204 });
  },
  'https://api.sandbox.ebay.com/sell/inventory/v1/offer': (init, url) => {
    sent.push({ method: init?.method ?? 'GET', url, body: body(init) });
    if (url.includes('/publish')) return { listingId: '110551234567' };
    if (url.includes('/withdraw')) return { listingId: '110551234567' };
    if (init?.method === 'POST') return { offerId: 'OFFER1' };
    if (init?.method === 'PUT') return new Response(null, { status: 204 });
    return new Response(
      JSON.stringify({ errors: [{ errorId: 25713, message: 'This Offer is not available.' }] }),
      { status: 404 },
    );
  },
  'https://api.sandbox.ebay.com/sell/inventory/v1/bulk_update_price_quantity': (init) => {
    const b = body(init) as {
      requests: { sku: string; shipToLocationAvailability: { quantity: number } }[];
    };
    sent.push({ method: 'POST', url: 'bulk', body: b });
    return { responses: b.requests.map((r) => ({ sku: r.sku, ...quantityAnswer(r.sku) })) };
  },
  'https://api.sandbox.ebay.com/sell/fulfillment/v1/order': (_init, url) => {
    sent.push({ method: 'GET', url, body: undefined });
    return { orders, total: orders.length };
  },
  'https://api.sandbox.ebay.com/commerce/taxonomy/v1/get_default_category_tree_id': () => ({
    categoryTreeId: '2',
  }),
  'https://api.sandbox.ebay.com/commerce/taxonomy/v1/category_tree/2/get_category_suggestions':
    () => ({
      categorySuggestions: [
        {
          category: { categoryId: '158666', categoryName: 'Anime & Manga' },
          categoryTreeNodeAncestors: [
            { categoryName: 'Action Figures' },
            { categoryName: 'Toys & Hobbies' },
          ],
        },
      ],
    }),
  'https://api.sandbox.ebay.com/commerce/taxonomy/v1/category_tree/2/get_item_aspects_for_category':
    () => ({
      aspects: [
        {
          localizedAspectName: 'Type',
          aspectConstraint: { aspectUsage: 'RECOMMENDED' },
          aspectValues: [{ localizedValue: 'Figure' }],
        },
        {
          localizedAspectName: 'Brand',
          aspectConstraint: { aspectRequired: true },
          aspectValues: [{ localizedValue: 'SEGA' }],
        },
      ],
    }),
});
afterAll(() => {
  ebay.restore();
  return shop.close();
});

/** Square stands in: its stock count, and every adjustment asked of it (with its idempotency key, as Square would dedupe them). */
let stock = 3;
const keys = new Set<string>();
const adjust = vi.spyOn(square, 'adjustStock').mockImplementation(async (_v, delta, key) => {
  if (keys.has(key)) return; // Square counts a repeated idempotency key once
  keys.add(key);
  stock += delta;
});
vi.spyOn(square, 'getInventoryCounts').mockImplementation(async (ids) =>
  Object.fromEntries(ids.map((id) => [id, stock])),
);
vi.spyOn(photos, 'list').mockResolvedValue({
  shown: [{ id: 'IMG1', url: 'https://items-images.example/sheryl.jpg' }],
  hidden: [],
});

beforeAll(async () => {
  await pglite.query(
    "insert into public.catalog_products (square_item_id, name, description, source, default_variation_id) values ('SQ_E', 'Sheryl Nome FIGURIZMa Figure (Macross Frontier)', 'A SEGA prize figure.', 'square', null) on conflict do nothing",
  );
  await pglite.query(
    "insert into public.catalog_variations (square_variation_id, square_item_id, sku, price_cents) values ('VAR_E', 'SQ_E', 'SH-1001', 4000) on conflict do nothing",
  );
  await pglite.query(
    "update public.catalog_products set default_variation_id = 'VAR_E' where square_item_id = 'SQ_E'",
  );
  await pglite.query(
    "insert into public.product_metadata (square_item_id, series, character, manufacturer, jan_code) values ('SQ_E', 'Macross Frontier', 'Sheryl Nome', 'SEGA', '4582733412345') on conflict do nothing",
  );
});

const order = (over: Record<string, unknown> = {}) => ({
  orderId: '27-11111-22222',
  creationDate: '2026-10-17T20:00:00.000Z',
  lastModifiedDate: '2026-10-17T20:00:00.000Z',
  orderPaymentStatus: 'PAID',
  cancelStatus: { cancelState: 'NONE_REQUESTED' },
  lineItems: [{ lineItemId: '10001', sku: 'SH-1001', quantity: 1 }],
  ...over,
});

describe('connecting the seller account', () => {
  it('sends an owner to eBay to sign in, and keeps the tokens encrypted when eBay sends them back', async () => {
    await http.post('/admin/ebay/connect').set(asStaff).expect(403);
    const { url } = (await http.post('/admin/ebay/connect').set(asOwner).expect(200)).body as {
      url: string;
    };
    const u = new URL(url);
    expect(u.origin).toBe('https://auth.sandbox.ebay.com');
    expect(u.searchParams.get('redirect_uri')).toBe('Spin_Hobby-SpinHobb-shop-abcdef');
    expect(u.searchParams.get('scope')).toContain('sell.inventory');
    const state = u.searchParams.get('state')!;

    // a made-up state is refused
    const forged = await http.get('/ebay/oauth/callback?code=abc&state=forged').expect(302);
    expect(forged.headers.location).toBe('https://shop.example/admin?ebay=error#Settings');

    const back = await http.get(`/ebay/oauth/callback?code=the-code&state=${state}`).expect(302);
    expect(back.headers.location).toBe('https://shop.example/admin?ebay=connected#Settings');
    expect(sent.find((s) => s.url === 'token')?.body).toContain('grant_type=authorization_code');
    // the same link cannot be used twice
    expect(
      (await http.get(`/ebay/oauth/callback?code=the-code&state=${state}`)).headers.location,
    ).toContain('ebay=error');

    const status = (await http.get('/admin/ebay').set(asStaff).expect(200)).body.ebay;
    expect(status).toMatchObject({
      configured: true,
      connected: true,
      username: 'spinhobby_seller',
      ready: false,
      environment: 'sandbox',
    });
    const row = (
      await pglite.query<{ access_token: string; refresh_token: string }>(
        'select access_token, refresh_token from public.ebay_connection',
      )
    ).rows[0];
    expect(row.access_token).not.toContain('user-access-token');
    expect(row.refresh_token.startsWith('v1.')).toBe(true);
  });

  it('saves the policies and location every listing uses, only ones the seller really has', async () => {
    const choices = (await http.get('/admin/ebay/setup').set(asOwner).expect(200)).body;
    expect(choices.policies.fulfillment).toEqual([{ id: 'F1', name: 'Canada Post' }]);
    expect(choices.locations[0]).toMatchObject({ key: 'store', address: 'Toronto, ON, CA' });
    await http
      .put('/admin/ebay/setup')
      .set(asOwner)
      .send({
        fulfillmentPolicyId: 'NOPE',
        paymentPolicyId: 'P1',
        returnPolicyId: 'R1',
        merchantLocationKey: 'store',
      })
      .expect(400);
    const saved = (
      await http
        .put('/admin/ebay/setup')
        .set(asOwner)
        .send({
          fulfillmentPolicyId: 'F1',
          paymentPolicyId: 'P1',
          returnPolicyId: 'R1',
          merchantLocationKey: 'store',
        })
        .expect(200)
    ).body.ebay;
    expect(saved.ready).toBe(true);
  });
});

describe('listing a product', () => {
  it('suggests categories and their item specifics', async () => {
    const cats = (await http.get('/admin/ebay/categories?q=sheryl figure').set(asStaff).expect(200))
      .body.categories;
    expect(cats[0]).toEqual({
      id: '158666',
      name: 'Anime & Manga',
      path: 'Toys & Hobbies > Action Figures > Anime & Manga',
    });
    const aspects = (
      await http.get('/admin/ebay/categories/158666/aspects').set(asStaff).expect(200)
    ).body.aspects;
    expect(aspects.map((a: { name: string; required: boolean }) => [a.name, a.required])).toEqual([
      ['Brand', true],
      ['Type', false],
    ]);
  });

  it("lists it with Square's count, the shop's photos, policies and price, and starts from what the shop knows", async () => {
    const before = (await http.get('/admin/ebay/products/SQ_E').set(asStaff).expect(200)).body;
    expect(before.listing).toBeNull();
    expect(before.draft).toMatchObject({
      title: 'Sheryl Nome FIGURIZMa Figure (Macross Frontier)',
      priceCents: 4000,
      aspects: { Brand: ['SEGA'], Franchise: ['Macross Frontier'], Character: ['Sheryl Nome'] },
    });

    const listed = (
      await http
        .put('/admin/ebay/products/SQ_E')
        .set(asStaff)
        .send({
          title: before.draft.title,
          description: 'A SEGA prize figure.',
          categoryId: '158666',
          condition: 'NEW',
          priceCents: 4500,
          aspects: { Brand: ['SEGA'], Type: ['Figure'] },
        })
        .expect(200)
    ).body;
    expect(listed.listing).toMatchObject({
      status: 'active',
      sku: 'SH-1001',
      listingId: '110551234567',
      quantity: 3,
      priceCents: 4500,
      url: 'https://sandbox.ebay.com/itm/110551234567',
    });
    const item = sent.find((s) => s.method === 'PUT' && s.url.includes('/inventory_item/SH-1001'))!
      .body as Record<string, any>;
    expect(item).toMatchObject({
      availability: { shipToLocationAvailability: { quantity: 3 } },
      condition: 'NEW',
      product: { imageUrls: ['https://items-images.example/sheryl.jpg'], ean: ['4582733412345'] },
    });
    const offer = sent.find(
      (s) => s.method === 'POST' && s.url.endsWith('/sell/inventory/v1/offer'),
    )!.body as Record<string, any>;
    expect(offer).toMatchObject({
      sku: 'SH-1001',
      marketplaceId: 'EBAY_CA',
      categoryId: '158666',
      availableQuantity: 3,
      merchantLocationKey: 'store',
      listingPolicies: { fulfillmentPolicyId: 'F1', paymentPolicyId: 'P1', returnPolicyId: 'R1' },
      pricingSummary: { price: { value: '45.00', currency: 'CAD' } },
    });
  });

  it('refuses a listing before setup, without a category, and below 99 cents', async () => {
    await http
      .put('/admin/ebay/products/SQ_E')
      .set(asStaff)
      .send({ title: 'x', categoryId: '', condition: 'NEW', priceCents: 4500 })
      .expect(400);
    await http
      .put('/admin/ebay/products/SQ_E')
      .set(asStaff)
      .send({ title: 'x', categoryId: '158666', condition: 'NEW', priceCents: 50 })
      .expect(400);
    await http
      .put('/admin/ebay/products/SQ_E')
      .set(asStaff)
      .send({ title: 'x', categoryId: '158666', condition: 'BROKEN', priceCents: 4500 })
      .expect(400);
  });
});

describe('keeping stock in step', () => {
  it('takes an eBay sale off Square once, however many times the order is read, then gives eBay the new count', async () => {
    orders = [order()];
    sent.length = 0;
    const first = (await http.post('/admin/ebay/sync').set(asStaff).expect(200)).body;
    expect(first.orders).toEqual({ applied: 1, restocked: 0, failed: 0 });
    expect(adjust).toHaveBeenLastCalledWith(
      'VAR_E',
      -1,
      'ebay-sale-27-11111-22222-10001',
      '2026-10-17T20:00:00.000Z',
    );
    expect(stock).toBe(2);
    const bulk = sent
      .filter((s) => s.url === 'bulk')
      .map((s) => (s.body as any).requests[0].shipToLocationAvailability.quantity);
    expect(bulk).toContain(2);
    // read again: nothing more comes off
    const calls = adjust.mock.calls.length;
    await http.post('/admin/ebay/sync').set(asStaff).expect(200);
    expect(adjust.mock.calls.length).toBe(calls);
    expect(stock).toBe(2);
    const line = (
      await pglite.query(
        "select status, square_item_id from public.ebay_order_lines where order_id = '27-11111-22222'",
      )
    ).rows[0];
    expect(line).toEqual({ status: 'applied', square_item_id: 'SQ_E' });
  });

  it('puts a cancelled order back once', async () => {
    orders = [
      order({
        cancelStatus: { cancelState: 'CANCELED' },
        lastModifiedDate: '2026-10-17T21:00:00.000Z',
      }),
    ];
    const r = (await http.post('/admin/ebay/sync').set(asStaff).expect(200)).body;
    expect(r.orders.restocked).toBe(1);
    expect(adjust).toHaveBeenLastCalledWith('VAR_E', 1, 'ebay-restock-27-11111-22222-10001');
    expect(stock).toBe(3);
    await http.post('/admin/ebay/sync').set(asStaff).expect(200);
    expect(stock).toBe(3);
  });

  it('tries a sale Square refused again, with the same key, even after eBay stops reporting the order', async () => {
    orders = [
      order({
        orderId: '27-33333-44444',
        lineItems: [{ lineItemId: '20001', sku: 'SH-1001', quantity: 1 }],
      }),
    ];
    adjust.mockImplementationOnce(async () => {
      throw new Error('Square is down');
    });
    const r = (await http.post('/admin/ebay/sync').set(asStaff).expect(200)).body;
    expect(r.orders.failed).toBe(1);
    expect(stock).toBe(3);
    expect(r.ebay.sync.lastError).toMatch(/Square is down/);
    orders = [];
    await http.post('/admin/ebay/sync').set(asStaff).expect(200);
    expect(adjust).toHaveBeenLastCalledWith(
      'VAR_E',
      -1,
      'ebay-sale-27-33333-44444-20001',
      expect.any(String),
    );
    expect(stock).toBe(2);
    expect(
      (
        await pglite.query(
          "select status from public.ebay_order_lines where order_id = '27-33333-44444'",
        )
      ).rows[0],
    ).toEqual({ status: 'applied' });
  });

  it('leaves alone an order of an item the shop did not list from here', async () => {
    orders = [
      order({
        orderId: '27-55555-66666',
        lineItems: [{ lineItemId: '30001', sku: 'LISTED-BY-HAND', quantity: 1 }],
      }),
    ];
    const calls = adjust.mock.calls.length;
    await http.post('/admin/ebay/sync').set(asStaff).expect(200);
    expect(adjust.mock.calls.length).toBe(calls);
    expect(
      (
        await pglite.query(
          "select status from public.ebay_order_lines where order_id = '27-55555-66666'",
        )
      ).rows[0],
    ).toEqual({ status: 'skipped' });
  });

  it("gives eBay Square's count when Square's stock changes (a sale on the website or at the till)", async () => {
    orders = [];
    sent.length = 0;
    stock = 0;
    inventoryEvents.changed(['VAR_E', 'SOMETHING_ELSE']);
    await new Promise((r) => setTimeout(r, 2600));
    await sync.pushQuantities(); // waits for the push the change started
    const pushed = sent.filter((s) => s.url === 'bulk').map((s) => (s.body as any).requests);
    expect(pushed.flat()).toEqual([
      {
        sku: 'SH-1001',
        shipToLocationAvailability: { quantity: 0 },
        offers: [{ offerId: 'OFFER1', availableQuantity: 0 }],
      },
    ]);
    expect((await http.get('/admin/ebay/products/SQ_E').set(asStaff)).body.listing).toMatchObject({
      status: 'out_of_stock',
      quantity: 0,
    });
    // back in stock: eBay hears again
    stock = 4;
    await sync.pushQuantities(['VAR_E']);
    expect((await http.get('/admin/ebay/products/SQ_E').set(asStaff)).body.listing).toMatchObject({
      status: 'active',
      quantity: 4,
    });
  });

  it('records a listing eBay refused the quantity for, and says so', async () => {
    quantityAnswer = () => ({
      statusCode: 400,
      errors: [{ message: 'The item cannot be revised.' }],
    });
    stock = 5;
    const r = await sync.pushQuantities(['VAR_E']);
    quantityAnswer = () => ({ statusCode: 200 });
    expect(r.failed).toBe(1);
    expect((await http.get('/admin/ebay/products/SQ_E').set(asStaff)).body.listing.error).toMatch(
      /cannot be revised/,
    );
    // the reconcile sets it again
    await sync.reconcile();
    expect((await http.get('/admin/ebay/products/SQ_E').set(asStaff)).body.listing).toMatchObject({
      quantity: 5,
      error: null,
    });
  });
});

describe('photos on the shop background', () => {
  it('gives eBay a transparent photo on the shop background, and the new one when the background changes', async () => {
    const listings = shop.app.get(EbayListingsService);
    const before = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = 'https://api.spinhobby.example';
    const backgrounds = shop.app.get(PhotoBackgroundsService);
    await pglite.query(
      "insert into public.product_cutouts (square_item_id, image_id, cutout_url, transparent) values ('SQ_E', 'IMG1', 'https://proj.supabase.co/storage/v1/object/public/product-images/imports/c.png', true)",
    );
    const photosOf = () =>
      (
        [...sent]
          .reverse()
          .find((s) => s.method === 'PUT' && s.url.includes('/inventory_item/SH-1001'))!
          .body as Record<string, any>
      ).product.imageUrls as string[];
    expect(await listings.refreshPhotos()).toEqual({ updated: 1, failed: 0 });
    const white = photosOf();
    expect(white).toEqual([
      'https://api.spinhobby.example/product-photos/on-background?image=IMG1&b=white',
    ]);
    // the rest of the listing is written back as it was
    const item = [...sent]
      .reverse()
      .find((s) => s.method === 'PUT' && s.url.includes('/inventory_item/SH-1001'))!.body as Record<
      string,
      any
    >;
    expect(item).toMatchObject({ condition: 'NEW', product: { ean: ['4582733412345'] } });
    expect(item.sku).toBeUndefined();

    // a new shop background: the address names it, so eBay fetches the photo again
    await pglite.query(
      "insert into public.photo_backgrounds (id, name, image_url, is_default) values ('00000000-0000-4000-8000-0000000000aa', 'Halloween', 'https://proj.supabase.co/storage/v1/object/public/product-images/backgrounds/h.jpg', true)",
    );
    expect((await backgrounds.shopBackground())?.name).toBe('Halloween');
    await listings.refreshPhotos();
    expect(photosOf()).toEqual([
      expect.stringMatching(/image=IMG1&b=00000000-0000-4000-8000-0000000000aa$/),
    ]);
    await pglite.query("delete from public.product_cutouts where image_id = 'IMG1'");
    await pglite.query('delete from public.photo_backgrounds');
    if (before === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = before;
  });
});

describe('ending and disconnecting', () => {
  it('will not disconnect while a listing is live, ends the listing, then disconnects', async () => {
    expect(
      (await http.delete('/admin/ebay/connection').set(asOwner).send({}).expect(409)).body.error,
    ).toMatch(/listed on eBay/);
    const ended = (await http.post('/admin/ebay/products/SQ_E/end').set(asStaff).expect(200)).body;
    expect(ended.listing.status).toBe('ended');
    expect(sent.some((s) => s.url.includes('/offer/OFFER1/withdraw'))).toBe(true);
    await http.delete('/admin/ebay/connection').set(asStaff).send({}).expect(403);
    await http.delete('/admin/ebay/connection').set(asOwner).send({}).expect(200);
    expect((await http.get('/admin/ebay').set(asStaff)).body.ebay.connected).toBe(false);
  });
});

describe("eBay's account deletion notices", () => {
  it('answers the challenge with the hash eBay expects, and acknowledges notices', async () => {
    const r = await http.get('/ebay/account-deletion?challenge_code=abc123').expect(200);
    expect(r.body.challengeResponse).toBe(
      createHash('sha256')
        .update('abc123')
        .update('verification_token_for_tests_0123456789')
        .update('https://api.shop.example/ebay/account-deletion')
        .digest('hex'),
    );
    await http
      .post('/ebay/account-deletion')
      .send({ notification: { data: { username: 'someone', userId: 'x' } } })
      .expect(200);
  });
});
