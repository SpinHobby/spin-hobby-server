import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetSignupLimits } from '../src/auth/auth.controller.js';
import { createApp, createDatabase, JWT_SECRET, mockFetch, seedProduct, signUp, tokenFor } from './harness.js';

const ORIGIN = 'http://localhost:5173';
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;
let owner: Awaited<ReturnType<typeof signUp>>;
let staff: Awaited<ReturnType<typeof signUp>>;
let shopper: Awaited<ReturnType<typeof signUp>>;

const address = { firstName: 'Aki', lastName: 'Tanaka', address1: '10 Jasper Ave', city: 'Edmonton', province: 'AB', postalCode: 'T5J 0N3', country: 'CA' };

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_JWT_SECRET: JWT_SECRET,
    OWNER_EMAILS: 'boss@spinhobby.com',
    ALLOWED_ORIGINS: ORIGIN,
    PAYPAL_CLIENT_ID: 'pp-client', PAYPAL_CLIENT_SECRET: 'pp-secret', PAYPAL_ENV: 'sandbox',
    SQUARE_ACCESS_TOKEN: 'sq-token', SQUARE_LOCATION_ID: 'LOC1', SQUARE_ENV: 'sandbox', SQUARE_APPLICATION_ID: 'sandbox-sq0idb-app',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'whsec', SQUARE_WEBHOOK_URL: 'https://api.spinhobby.com/webhooks/square',
    RESEND_API_KEY: 're_test', FROM_EMAIL: 'shop@spinhobby.com',
    SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  });
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());

  await seedProduct(pglite, { id: 'FIG1', name: 'Rem 1/7 Scale Figure', category: 'Scale Figures', priceCents: 22900, availability: 'preorder', orderBy: future(20), releaseMonth: '2027-03-01', series: 'Re:Zero', jan: '4580000000001', featured: true, rank: 1, image: 'https://img/fig1.jpg' });
  await seedProduct(pglite, { id: 'PRZ1', name: 'Miku Prize Figure', category: 'Prize Figures', priceCents: 3900, stock: 12, series: 'Vocaloid', rank: 2 });
  await seedProduct(pglite, { id: 'CHB1', name: 'Chibi Figure', category: 'Chibi Figures', priceCents: 6400, stock: 2, maxPer: 1, compareAt: 7900 });
  await seedProduct(pglite, { id: 'BDG1', name: 'Can Badge Set', category: 'Badges & Acrylics', priceCents: 1800, stock: 0 });
  await seedProduct(pglite, { id: 'OLD1', name: 'Closed Pre-order Plush', category: 'Plushies', priceCents: 5500, availability: 'preorder', orderBy: past(2) });
  await seedProduct(pglite, { id: 'HID1', name: 'Hidden Convention One-off', category: 'Other', priceCents: 1000, stock: 5, availability: 'hidden' });

  owner = await signUp(pglite, 'boss@spinhobby.com');
  staff = await signUp(pglite, 'helper@spinhobby.com', 'staff');
  shopper = await signUp(pglite, 'fan@example.com');
});

afterAll(async () => {
  await app?.close();
  await pglite?.close();
});

describe('platform', () => {
  it('reports liveness and detailed health', async () => {
    await http.get('/health/live').expect(200);
    process.env.DATABASE_URL = 'postgresql://unused-in-tests'; // the test DB driver is injected
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const supabase = mockFetch({
      '/auth/v1/settings': () => ({ external: { email: true } }),
      '/storage/v1/bucket/product-images': () => new Response('{}', { status: 404 }),
    });
    try {
      const res = await http.get('/health').expect(200);
      expect(res.body).toMatchObject({
        success: true, status: 'ok',
        checks: {
          config: { ok: true, missing: [] },
          database: { ok: true },
          schema: { ok: true, missingTables: [] },
          auth: { ok: true, password: true },
          storage: { ok: false, error: 'bucket_missing' }, // storage problems are reported but don't fail readiness
        },
        integrations: { paypal: 'configured', square: 'configured', email: 'configured', cashierAi: 'not_configured' },
      });
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      const degraded = await http.get('/health').expect(503);
      expect(degraded.body.checks.config.missing).toEqual(['SUPABASE_PUBLISHABLE_KEY']);
      expect(degraded.body.checks.auth).toMatchObject({ ok: false, error: 'not_configured' });
    } finally {
      supabase.restore();
      process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    }
  });

  it('returns JSON 404s in the storefront error shape', async () => {
    const res = await http.get('/nope').expect(404);
    expect(res.body).toEqual({ success: false, error: 'Route not found.' });
  });

  it('refuses unknown browser origins and allows configured ones', async () => {
    await http.get('/products').set('Origin', 'https://evil.example').expect(403);
    await http.get('/products').set('Origin', 'http://localhost:61234').expect(200); // any localhost port outside production
    const ok = await http.get('/products').set('Origin', ORIGIN).expect(200);
    expect(ok.headers['access-control-allow-origin']).toBe(ORIGIN);
    const preflight = await http.options('/cart/quote').set('Origin', 'https://spinhobby.com').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://spinhobby.com');
  });
});

describe('storefront catalog', () => {
  it('lists visible products in the public shape and hides hidden ones', async () => {
    const res = await http.get('/products?limit=60').expect(200);
    expect(res.body.total).toBe(5);
    expect(res.body.items.map((p: any) => p.id)).not.toContain('HID1');
    const fig = res.body.items.find((p: any) => p.id === 'FIG1');
    expect(fig).toEqual({
      id: 'FIG1', variationId: 'FIG1_V', name: 'Rem 1/7 Scale Figure', series: 'Re:Zero', character: null, category: 'Scale Figures', categoryId: null,
      images: ['https://img/fig1.jpg'], priceCents: 22900, compareAtCents: null, currency: 'CAD', status: 'pre', stockCount: null,
      releaseMonth: '2027-03-01', orderByDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), rank: 1, maxPerCustomer: null,
    });
  });

  it('derives status from stock and pre-order dates like the storefront expects', async () => {
    const res = await http.get('/products?limit=60').expect(200);
    const status = Object.fromEntries(res.body.items.map((p: any) => [p.id, p.status]));
    expect(status).toMatchObject({ FIG1: 'pre', PRZ1: 'in', CHB1: 'low', BDG1: 'out', OLD1: 'closed' });
  });

  it('filters by category, status, price and search (series / JAN) and pages with a cursor', async () => {
    expect((await http.get('/products?category=Prize%20Figures')).body.items.map((p: any) => p.id)).toEqual(['PRZ1']);
    expect((await http.get('/products?status=in,low&sort=price_asc')).body.items.map((p: any) => p.id)).toEqual(['PRZ1', 'CHB1']);
    expect((await http.get('/products?min=50&max=100')).body.items.map((p: any) => p.id).sort()).toEqual(['CHB1', 'OLD1']);
    expect((await http.get('/products?min=25&max=39')).body.items).toEqual([]); // max is exclusive ($39 falls in the next bucket)
    expect((await http.get('/products?q=re:zero')).body.items.map((p: any) => p.id)).toEqual(['FIG1']);
    expect((await http.get('/products?q=4580000000001')).body.items.map((p: any) => p.id)).toEqual(['FIG1']);
    expect((await http.get('/products?q=100%25')).body.items).toEqual([]); // LIKE wildcards are escaped
    const first = (await http.get('/products?limit=2&sort=price_desc')).body;
    expect(first.cursor).toBe('2');
    const second = (await http.get(`/products?limit=2&sort=price_desc&cursor=${first.cursor}`)).body;
    expect([...first.items, ...second.items].map((p: any) => p.id)).toEqual(['FIG1', 'CHB1', 'OLD1', 'PRZ1']);
  });

  it('serves facets, shortcut lists and the homepage payload', async () => {
    const facets = (await http.get('/products/facets').expect(200)).body;
    expect(facets.status).toEqual({ in: 2, pre: 1, out: 2 });
    expect(facets.price.map((b: any) => b.count)).toEqual([1, 3, 0, 1]); // $18 | $39 $55 $64 | - | $229
    expect((await http.get('/products/preorders')).body.items.map((p: any) => p.id)).toEqual(['FIG1']);
    expect((await http.get('/products/ranking')).body.items.map((p: any) => p.id)).toEqual(['FIG1', 'PRZ1']);
    const home = (await http.get('/homepage').expect(200)).body;
    expect(home.featuredItems.map((p: any) => p.id)).toEqual(['FIG1']);
    expect(home.preorders.map((p: any) => p.id)).toEqual(['FIG1']);
    expect(home.newInStock.map((p: any) => p.id).sort()).toEqual(['CHB1', 'PRZ1']);
    expect(home.categories).toEqual([]);
    // No slides/events configured yet: the server supplies the welcome defaults.
    expect(home.slides.map((sl: any) => sl.headline)).toEqual(['New arrivals every week', 'Free shipping on orders $75+', 'Join our Discord community']);
    expect(home.events.map((e: any) => e.name)).toContain('Otafest');
    expect(home.promos).toEqual({ closingSoon: 1, maxDiscountPct: 19 }); // FIG1 closes in 20 days; CHB1 $64 vs $79
  });

  it('exposes public checkout config driven by store settings', async () => {
    const res = await http.get('/checkout/config').expect(200);
    expect(res.body).toMatchObject({ provider: 'paypal', paypalClientId: 'pp-client', squareEnv: 'sandbox', freeShippingThresholdCents: 7500, handlingDaysMin: 2, handlingDaysMax: 3, fxCadUsd: 0.73 });
  });
});

describe('storefront sections and server-side filters', () => {
  it('filters by menu section, sale, wishlist ids and featured order', async () => {
    const ids = (url: string) => http.get(url).then((r) => r.body.items.map((p: any) => p.id));
    expect((await ids('/products?group=figures&limit=60')).sort()).toEqual(['CHB1', 'FIG1', 'PRZ1']);
    expect(await ids('/products?group=preorders')).toEqual(['FIG1']);
    expect((await ids('/products?group=new&limit=60')).sort()).toEqual(['CHB1', 'PRZ1']);
    expect(await ids('/products?group=sale')).toEqual(['CHB1']);
    expect(await ids('/products?group=plushies')).toEqual(['OLD1']);
    expect((await ids('/products?ids=PRZ1,BDG1,HID1')).sort()).toEqual(['BDG1', 'PRZ1']);
    expect(await ids('/products?ids=')).toEqual([]);
    expect((await ids('/products?sort=featured&limit=60'))[0]).toBe('FIG1');
    await http.get('/products?group=nonsense').expect(400, { success: false, error: 'Unknown section.' });
    await http.get('/products?categoryId=nope').expect(400);
  });
});

describe('sign-in through the API', () => {
  const gotrue = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('lists the enabled providers', async () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    const auth = mockFetch({ '/auth/v1/settings': () => ({ external: { email: true, google: true, discord: false } }) });
    try {
      expect((await http.get('/auth/providers').expect(200)).body).toEqual({ success: true, password: true, signup: true, google: true, discord: false });
    } finally { auth.restore(); }
  });

  it('signs in with email + password and returns a session with the profile', async () => {
    const auth = mockFetch({
      'grant_type=password': (init) => {
        const body = JSON.parse(String(init?.body));
        return body.password === 'right' ? gotrue(200, { access_token: shopper.token, refresh_token: 'r1', expires_in: 3600 })() : gotrue(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' })();
      },
      'grant_type=refresh_token': gotrue(200, { access_token: shopper.token, refresh_token: 'r2', expires_at: 1900000000 }),
    });
    try {
      await http.post('/auth/login').send({ email: 'fan@example.com', password: 'wrong' }).expect(401, { success: false, error: 'Wrong email or password.' });
      const ok = await http.post('/auth/login').send({ email: 'Fan@Example.com', password: 'right' }).expect(200);
      expect(ok.body).toMatchObject({ success: true, accessToken: shopper.token, refreshToken: 'r1', user: { email: 'fan@example.com', role: 'customer' } });
      expect(ok.body.expiresAt).toBeGreaterThan(Date.now() / 1000);
      expect(auth.calls[0].body).toEqual({ email: 'fan@example.com', password: 'wrong' });
      const refreshed = await http.post('/auth/refresh').send({ refreshToken: 'r1' }).expect(200);
      expect(refreshed.body).toMatchObject({ refreshToken: 'r2', expiresAt: 1900000000 });
    } finally { auth.restore(); }
  });

  it('creates confirmed customer accounts without sending email', async () => {
    resetSignupLimits();
    const newbie = { id: '00000000-0000-4000-8000-00000000abcd', email: 'newbie@example.com' };
    const auth = mockFetch({
      '/auth/v1/admin/users': async (init) => {
        const body = JSON.parse(String(init?.body));
        if (body.email === 'fan@example.com') return gotrue(422, { error_code: 'email_exists', msg: 'A user with this email address has already been registered' })();
        await pglite.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [newbie.id, body.email, JSON.stringify(body.user_metadata)]);
        return gotrue(200, { id: newbie.id, email: body.email })();
      },
      'grant_type=password': async () => gotrue(200, { access_token: await tokenFor(newbie.id, newbie.email), refresh_token: 'n1', expires_in: 3600 })(),
    });
    try {
      await http.post('/auth/signup').send({ email: 'not-an-email', password: 'longenough' }).expect(400);
      await http.post('/auth/signup').send({ email: 'x@example.com', password: 'short' }).expect(400, { success: false, error: 'Use a password with at least 8 characters.' });
      await http.post('/auth/signup').send({ email: 'fan@example.com', password: 'longenough' }).expect(409);
      const ok = await http.post('/auth/signup').send({ email: 'Newbie@Example.com', password: 'longenough', firstName: 'Nia' }).expect(201);
      expect(ok.body).toMatchObject({ success: true, refreshToken: 'n1', user: { email: 'newbie@example.com', role: 'customer' } });
      const created = auth.calls.find((c) => c.url.includes('/admin/users') && c.body.email === 'newbie@example.com');
      expect(created?.body).toEqual({ email: 'newbie@example.com', password: 'longenough', email_confirm: true, user_metadata: { first_name: 'Nia' } });
      const profile = await pglite.query<{ first_name: string }>('select first_name from public.profiles where id = $1', [newbie.id]);
      expect(profile.rows[0].first_name).toBe('Nia');
      for (let i = 0; i < 3; i++) await http.post('/auth/signup').send({ email: 'fan@example.com', password: 'longenough' }).expect(409);
      await http.post('/auth/signup').send({ email: 'late@example.com', password: 'longenough' }).expect(429);
    } finally { auth.restore(); resetSignupLimits(); }
  });

  it('builds OAuth links only for allowed sites', async () => {
    const res = await http.get('/auth/oauth-url?provider=google&redirectTo=https://spinhobby.com/admin').expect(200);
    expect(res.body.url).toBe('https://proj.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fspinhobby.com%2Fadmin');
    await http.get('/auth/oauth-url?provider=google&redirectTo=https://evil.example/steal').expect(400);
    await http.get('/auth/oauth-url?provider=myspace&redirectTo=https://spinhobby.com').expect(400);
  });
});

describe('accounts', () => {
  it('requires sign-in and rejects forged tokens', async () => {
    await http.get('/auth/me').expect(401, { success: false, error: 'Sign in is required.' });
    await http.get('/auth/me').set('Authorization', `Bearer ${shopper.token}x`).expect(401);
    const { SignJWT } = await import('jose');
    const foreign = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(shopper.id).setAudience('authenticated')
      .setIssuer('https://other-project.supabase.co/auth/v1').setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET));
    await http.get('/auth/me').set('Authorization', `Bearer ${foreign}`).expect(401);
  });

  it('returns the profile and promotes OWNER_EMAILS on sign-in', async () => {
    expect((await http.get('/auth/me').set('Authorization', shopper.auth).expect(200)).body.user).toMatchObject({ email: 'fan@example.com', role: 'customer', firstName: null });
    const named = await tokenFor(shopper.id, 'fan@example.com', { full_name: '  Aki Tanaka ' });
    expect((await http.get('/auth/me').set('Authorization', `Bearer ${named}`).expect(200)).body.user.firstName).toBe('Aki');
    expect((await http.get('/auth/me').set('Authorization', owner.auth).expect(200)).body.user.role).toBe('owner');
    const row = await pglite.query<{ role: string }>('select role from public.profiles where id = $1', [owner.id]);
    expect(row.rows[0].role).toBe('owner');
  });

  it('manages a wishlist', async () => {
    await http.post('/wishlist').set('Authorization', shopper.auth).send({ squareItemId: 'PRZ1' }).expect(200);
    await http.post('/wishlist').set('Authorization', shopper.auth).send({ squareItemId: 'PRZ1' }).expect(200); // idempotent
    await http.post('/wishlist').set('Authorization', shopper.auth).send({ squareItemId: 'HID1' }).expect(400);
    expect((await http.get('/wishlist').set('Authorization', shopper.auth)).body.items.map((p: any) => p.id)).toEqual(['PRZ1']);
    await http.delete('/wishlist/PRZ1').set('Authorization', shopper.auth).expect(200);
    expect((await http.get('/wishlist').set('Authorization', shopper.auth)).body.items).toEqual([]);
  });

  it('records restock alerts for guests and validates input', async () => {
    await http.post('/alerts').send({ email: 'Guest@Example.com', variationId: 'BDG1_V' }).expect(200);
    await http.post('/alerts').send({ email: 'guest@example.com', variationId: 'BDG1_V' }).expect(200);
    await http.post('/alerts').send({ email: 'not-an-email', variationId: 'BDG1_V' }).expect(400, { success: false, error: 'Enter a valid email address.' });
    await http.post('/alerts').send({ email: 'a@b.com', variationId: 'NOPE' }).expect(400);
    const rows = await pglite.query('select email from public.stock_alerts');
    expect(rows.rows).toEqual([{ email: 'guest@example.com' }]);
  });
});

describe('cart quote', () => {
  const quote = (items: any[], extra: Record<string, unknown> = {}) =>
    http.post('/cart/quote').send({ items, shippingMethod: 'standard', country: 'CA', province: 'AB', ...extra });

  it('prices lines server-side with shipping and provincial tax', async () => {
    const res = await quote([{ variationId: 'PRZ1_V', quantity: 1 }]).expect(200);
    expect(res.body).toMatchObject({ subtotalCents: 3900, shippingCents: 899, taxCents: Math.round((3900 + 899) * 0.05), warnings: [] });
    expect(res.body.totalCents).toBe(3900 + 899 + res.body.taxCents);
    const free = await quote([{ variationId: 'PRZ1_V', quantity: 2 }], { province: 'ON' }).expect(200);
    expect(free.body).toMatchObject({ subtotalCents: 7800, shippingCents: 0, taxCents: Math.round(7800 * 0.13) });
    const express = await quote([{ variationId: 'PRZ1_V', quantity: 2 }], { shippingMethod: 'express' }).expect(200);
    expect(express.body.shippingCents).toBe(1999);
  });

  it('warns about stock, limits and closed pre-orders', async () => {
    const res = await quote([
      { variationId: 'CHB1_V', quantity: 2 }, // stock 2 but max 1 per customer
      { variationId: 'BDG1_V', quantity: 1 }, // sold out
      { variationId: 'OLD1_V', quantity: 1 }, // pre-order closed
      { variationId: 'FIG1_V', quantity: 3 }, // pre-order: no stock limit
    ]).expect(200);
    expect(res.body.warnings.map((w: any) => w.code)).toEqual(['LIMIT_EXCEEDED', 'OUT_OF_STOCK', 'PREORDER_CLOSED']);
    expect(res.body.lines).toEqual([expect.objectContaining({ variationId: 'FIG1_V', quantity: 3, isPreorder: true, imageUrl: 'https://img/fig1.jpg' })]);
  });

  it('rejects malformed carts with the storefront messages', async () => {
    await quote([]).expect(400, { success: false, error: 'Your cart must contain between 1 and 40 items.' });
    await quote([{ variationId: 'PRZ1_V', quantity: 1 }], { province: '' }).expect(400);
    await quote([{ variationId: 'PRZ1_V', quantity: 0 }]).expect(400, { success: false, error: 'quantity must be between 1 and 99.' });
    await quote([{ variationId: 'MISSING', quantity: 1 }]).expect(400, { success: false, error: 'One or more products are no longer available.' });
  });
});

describe('checkout', () => {
  const body = (items: any[]) => ({ quote: { items, shippingMethod: 'standard', country: 'CA', province: 'AB' }, email: 'Fan@Example.com', billing: address, shipping: address });

  it('creates a PayPal order and captures it', async () => {
    const paypal = mockFetch({
      '/v1/oauth2/token': () => ({ access_token: 'tok' }),
      '/v2/checkout/orders/PP-1/capture': () => ({ status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1' }] } }], links: [{ rel: 'self', href: 'https://pp/receipt' }] }),
      '/v2/checkout/orders': () => ({ id: 'PP-1' }),
    });
    try {
      const intent = await http.post('/checkout/intent').set('Authorization', shopper.auth).send(body([{ variationId: 'PRZ1_V', quantity: 1 }])).expect(200);
      expect(intent.body).toMatchObject({ success: true, provider: 'paypal', paypalOrderId: 'PP-1' });
      const order = (await pglite.query<any>('select * from public.orders where id = $1', [intent.body.orderId])).rows[0];
      expect(order).toMatchObject({ status: 'pending', billing_email: 'fan@example.com', user_id: shopper.id, total_cents: 3900 + 899 + 240 });
      const created = paypal.calls.find((c) => c.url.endsWith('/v2/checkout/orders'))!;
      expect(created.body.purchase_units[0].amount).toEqual({ currency_code: 'CAD', value: '50.39' });

      const capture = await http.post('/paypal/capture').send({ paypalOrderId: 'PP-1' }).expect(200);
      expect(capture.body).toEqual({ success: true, orderId: intent.body.orderId, status: 'paid' });
      await http.post('/paypal/capture').send({ paypalOrderId: 'PP-1' }).expect(200); // idempotent retry
      const events = await pglite.query<any>('select event_type from public.order_events where order_id = $1 order by id', [intent.body.orderId]);
      expect(events.rows.map((e) => e.event_type)).toEqual(['created', 'paid']);
      const mine = await http.get('/orders').set('Authorization', shopper.auth).expect(200);
      expect(mine.body.items.map((o: any) => o.id)).toContain(intent.body.orderId);
      await http.get(`/orders/${intent.body.orderId}`).set('Authorization', staff.auth).expect(200);
      const other = await signUp(pglite, 'other@example.com');
      await http.get(`/orders/${intent.body.orderId}`).set('Authorization', other.auth).expect(404);
    } finally {
      paypal.restore();
    }
  });

  it('refuses to create an order when the cart changed, returning the fresh quote', async () => {
    const res = await http.post('/checkout/intent').send(body([{ variationId: 'BDG1_V', quantity: 1 }])).expect(409);
    expect(res.body).toMatchObject({ success: false, code: 'CART_CHANGED', quote: { warnings: [{ code: 'OUT_OF_STOCK' }] } });
    const count = await pglite.query<any>("select count(*)::int as n from public.orders where billing_email = 'fan@example.com'");
    expect(count.rows[0].n).toBe(1); // only the PayPal order above
  });

  it('charges a Square card and reserves pre-orders', async () => {
    await http.put('/admin/settings').set('Authorization', owner.auth).send({ payment_provider: 'square' }).expect(200);
    const square = mockFetch({
      '/v2/orders': () => ({ order: { id: 'SQ-ORDER' } }),
      '/v2/payments': () => ({ payment: { id: 'SQ-PAY', status: 'COMPLETED', receipt_url: 'https://sq/receipt' } }),
    });
    try {
      const intent = await http.post('/checkout/intent').send(body([{ variationId: 'FIG1_V', quantity: 1 }])).expect(200);
      expect(intent.body).toMatchObject({ provider: 'square', amountCents: Math.round(22900 * 1.05), currency: 'CAD' });
      await http.post('/square/payments').send({ orderId: intent.body.orderId, email: 'wrong@example.com', sourceId: 'cnon:ok' }).expect(404);
      const paid = await http.post('/square/payments').send({ orderId: intent.body.orderId, email: 'fan@example.com', sourceId: 'cnon:ok', verificationToken: 'vt' }).expect(200);
      expect(paid.body.status).toBe('preorder_reserved');
      const payment = square.calls.find((c) => c.url.endsWith('/v2/payments'))!;
      expect(payment.body).toMatchObject({ source_id: 'cnon:ok', order_id: 'SQ-ORDER', location_id: 'LOC1', verification_token: 'vt', amount_money: { amount: Math.round(22900 * 1.05), currency: 'CAD' } });
    } finally {
      square.restore();
      await http.put('/admin/settings').set('Authorization', owner.auth).send({ payment_provider: 'paypal' }).expect(200);
    }
  });
});

describe('webhooks', () => {
  const sign = (raw: string) => createHmac('sha256', 'whsec').update('https://api.spinhobby.com/webhooks/square' + raw).digest('base64');

  it('verifies Square signatures, applies IN_STOCK counts, and ignores duplicates', async () => {
    const event = JSON.stringify({ event_id: 'evt-1', type: 'inventory.count.updated', created_at: new Date().toISOString(),
      data: { object: { inventory_counts: [
        { catalog_object_id: 'BDG1_V', state: 'IN_STOCK', quantity: '7' },
        { catalog_object_id: 'BDG1_V', state: 'SOLD', quantity: '99' },
        { catalog_object_id: 'UNKNOWN_V', state: 'IN_STOCK', quantity: '3' },
      ] } } });
    await http.post('/webhooks/square').set('Content-Type', 'application/json').set('x-square-hmacsha256-signature', 'bad').send(event).expect(401);
    await http.post('/webhooks/square').set('Content-Type', 'application/json').set('x-square-hmacsha256-signature', sign(event)).send(event).expect(200, { success: true });
    await http.post('/webhooks/square').set('Content-Type', 'application/json').set('x-square-hmacsha256-signature', sign(event)).send(event).expect(200, { success: true, duplicate: true });
    const stock = await pglite.query<any>("select quantity from public.inventory_snapshots where square_variation_id = 'BDG1_V'");
    expect(stock.rows[0].quantity).toBe(7);
    expect((await http.get('/products?q=Can%20Badge')).body.items[0].status).toBe('in');
  });
});

describe('square catalog sync', () => {
  it('mirrors Square items, variations, images and stock', async () => {
    const square = mockFetch({
      '/v2/catalog/search-catalog-items': () => ({ items: [{
        id: 'SQ_ITEM', type: 'ITEM', updated_at: '2026-09-01T00:00:00Z',
        item_data: { name: 'Synced Plushie', description_plaintext: 'Soft', categories: [{ id: 'CAT1' }], image_ids: ['IMG1'],
          variations: [{ id: 'SQ_VAR', type: 'ITEM_VARIATION', item_variation_data: { name: 'Regular', price_money: { amount: 3200, currency: 'CAD' } } }] },
      }], related_objects: [{ id: 'IMG1', type: 'IMAGE', image_data: { url: 'https://sq/img1.jpg' } }] }),
      '/v2/catalog/search': () => ({ objects: [{ id: 'CAT1', type: 'CATEGORY', category_data: { name: 'Plushies' } }] }),
      '/v2/inventory/counts/batch-retrieve': () => ({ counts: [{ catalog_object_id: 'SQ_VAR', quantity: '4' }] }),
    });
    try {
      await http.post('/admin/square/sync').set('Authorization', staff.auth).expect(403); // owner only
      const res = await http.post('/admin/square/sync').set('Authorization', owner.auth).expect(200);
      expect(res.body.sync).toMatchObject({ products: 1, variations: 1, inventory: 1 });
      await http.post('/square-sync').expect(403);
      const product = (await http.get('/square/catalog/SQ_ITEM').expect(200)).body.item;
      expect(product).toMatchObject({ name: 'Synced Plushie', category: 'Plushies', priceCents: 3200, stockCount: 4, status: 'in', images: ['https://sq/img1.jpg'] });
      const readiness = (await http.get('/admin/square/readiness').set('Authorization', staff.auth).expect(200)).body.readiness;
      expect(readiness).toMatchObject({ appAndLocationConnected: true, catalogAndInventorySyncing: true, webhookKeySet: true, activeProvider: 'paypal' });
    } finally {
      square.restore();
    }
  });
});

describe('admin', () => {
  it('is closed to customers and anonymous callers', async () => {
    await http.get('/admin/dashboard').expect(401);
    await http.get('/admin/dashboard').set('Authorization', shopper.auth).expect(403, { success: false, error: 'You do not have permission to perform this action.' });
  });

  it('summarises the dashboard', async () => {
    const res = await http.get('/admin/dashboard').set('Authorization', staff.auth).expect(200);
    expect(res.body).toMatchObject({ success: true, toShip: 1, openPreorders: 1, reservedUnits: 1, alertsWaiting: 1, preorderProducts: 1, ordersToday: 2 });
    expect(res.body.lowStockList.map((p: any) => p.id).sort()).toEqual(['CHB1']);
    expect(res.body.closingPreorders.map((p: any) => p.id)).toEqual(['FIG1']);
    expect(res.body.salesTodayCents).toBeGreaterThan(0);
  });

  it('lists products with admin-only fields and edits storefront metadata', async () => {
    await pglite.query("insert into public.stock_alerts (email, square_variation_id) values ('wait@example.com', 'CHB1_V')");
    const list = (await http.get('/admin/products?limit=60').set('Authorization', staff.auth).expect(200)).body.items;
    expect(list.find((p: any) => p.id === 'FIG1')).toMatchObject({ janCode: '4580000000001', availability: 'preorder', isFeatured: true, sortOrder: 0 });
    expect(list.find((p: any) => p.id === 'CHB1').alertsWaiting).toBe(1);
    expect((await http.get('/admin/products?filter=featured').set('Authorization', staff.auth)).body.items.map((p: any) => p.id)).toEqual(['FIG1']);

    await http.patch('/admin/products/PRZ1').set('Authorization', staff.auth).send({ availability: 'bogus' }).expect(400, { success: false, error: 'Invalid availability.' });
    await http.patch('/admin/products/PRZ1').set('Authorization', staff.auth).send({ max_per_customer: -1 }).expect(400);
    const updated = await http.patch('/admin/products/PRZ1').set('Authorization', staff.auth)
      .send({ availability: 'preorder', order_by_date: future(10), release_month: '2027-01-01', compare_at_cents: 4500, is_featured: true, sort_order: 2, jan_code: '' }).expect(200);
    expect(updated.body.product).toMatchObject({ availability: 'preorder', compare_at_cents: 4500, is_featured: true, sort_order: 2, jan_code: null });
    expect((await http.get('/square/catalog/PRZ1')).body.item).toMatchObject({ status: 'pre', compareAtCents: 4500, releaseMonth: '2027-01-01' });
    const log = await pglite.query<any>("select action, target from public.admin_logs where action = 'product.updated'");
    expect(log.rows).toEqual([{ action: 'product.updated', target: 'PRZ1' }]);
    await http.patch('/admin/products/PRZ1').set('Authorization', staff.auth).send({ availability: 'auto', order_by_date: '', release_month: '' }).expect(200);
    await http.patch('/admin/products/NOPE').set('Authorization', staff.auth).send({}).expect(404);
  });

  it('emails restock alerts', async () => {
    const email = mockFetch({ 'api.resend.com': () => ({ id: 'email-1' }) });
    try {
      const res = await http.post('/admin/products/CHB1/notify-restock').set('Authorization', staff.auth).expect(200);
      expect(res.body.sent).toBe(1);
      expect(email.calls[0].body).toMatchObject({ to: ['wait@example.com'], subject: 'Chibi Figure is back at Spin Hobby' });
      expect((await http.post('/admin/products/CHB1/notify-restock').set('Authorization', staff.auth)).body.sent).toBe(0);
    } finally {
      email.restore();
    }
  });

  it('ships, refunds and prints orders', async () => {
    const orders = (await http.get('/admin/orders?status=paid').set('Authorization', staff.auth).expect(200)).body;
    expect(orders.total).toBe(1);
    const order = orders.items[0];
    expect(order.order_items).toEqual([expect.objectContaining({ name: 'Miku Prize Figure', quantity: 1 })]);
    await http.get('/admin/orders?status=bogus').set('Authorization', staff.auth).expect(400);

    const mail = mockFetch({ 'api.resend.com': () => ({ id: 'e' }) });
    try {
      await http.post(`/admin/orders/${order.id}/ship`).set('Authorization', staff.auth).send({}).expect(400, { success: false, error: 'trackingNumber is required.' });
      const shipped = await http.post(`/admin/orders/${order.id}/ship`).set('Authorization', staff.auth).send({ trackingNumber: 'CP123', carrier: 'Canada Post' }).expect(200);
      expect(shipped.body).toEqual({ success: true, customerEmailed: true });
      expect(mail.calls[0].body.to).toEqual(['fan@example.com']);
      await http.post(`/admin/orders/${order.id}/ship`).set('Authorization', staff.auth).send({ trackingNumber: 'CP123' }).expect(400, { success: false, error: 'Only paid orders can be shipped.' });
    } finally {
      mail.restore();
    }

    const slip = await http.get(`/admin/orders/${order.id}/packing-slip`).set('Authorization', staff.auth).expect(200);
    expect(slip.body.html).toContain('Aki Tanaka');
    expect(slip.body.html).toContain('Miku Prize Figure');

    await http.post(`/admin/orders/${order.id}/refund`).set('Authorization', staff.auth).send({}).expect(403);
    const paypal = mockFetch({ '/v1/oauth2/token': () => ({ access_token: 'tok' }), '/refund': () => ({ id: 'R1', status: 'COMPLETED' }) });
    try {
      const refunded = await http.post(`/admin/orders/${order.id}/refund`).set('Authorization', owner.auth).send({}).expect(200);
      expect(refunded.body.status).toBe('refunded');
      expect(paypal.calls.find((c) => c.url.includes('/captures/CAP-1/refund'))!.body.amount.value).toBe((order.total_cents / 100).toFixed(2));
    } finally {
      paypal.restore();
    }
    const detail = (await http.get(`/admin/orders/${order.id}`).set('Authorization', staff.auth).expect(200)).body.order;
    expect(detail.order_events.map((e: any) => e.event_type)).toEqual(['created', 'paid', 'shipped', 'refunded']);
  });

  it('keeps settings and tax rates owner-only and validated', async () => {
    await http.put('/admin/settings').set('Authorization', staff.auth).send({ low_stock_threshold: 5 }).expect(403);
    await http.put('/admin/settings').set('Authorization', owner.auth).send({ handling_days_min: 5, handling_days_max: 3 }).expect(400);
    await http.put('/admin/settings').set('Authorization', owner.auth).send({ payment_provider: 'stripe' }).expect(400);
    const saved = await http.put('/admin/settings').set('Authorization', owner.auth).send({ free_shipping_threshold_cents: 10000, fx_cad_usd: 0.7 }).expect(200);
    expect(saved.body.settings).toMatchObject({ free_shipping_threshold_cents: 10000, fx_cad_usd: 0.7 });
    expect((await http.get('/checkout/config')).body).toMatchObject({ freeShippingThresholdCents: 10000, fxCadUsd: 0.7 });
    await http.put('/admin/settings').set('Authorization', owner.auth).send({ free_shipping_threshold_cents: 7500, fx_cad_usd: 0.73 }).expect(200);

    await http.get('/admin/tax-rates').set('Authorization', staff.auth).expect(403);
    const tax = await http.put('/admin/tax-rates').set('Authorization', owner.auth).send({ country: 'US', province: 'wa', rate: 0.065 }).expect(200);
    expect(tax.body.taxRate).toMatchObject({ country: 'US', province: 'WA', rate: 0.065, enabled: true });
  });

  it('manages hero slides and events end to end', async () => {
    const a = (await http.post('/admin/homepage/slides').set('Authorization', staff.auth).send({ headline: 'First', isVisible: true }).expect(200)).body.slide;
    const b = (await http.post('/admin/homepage/slides').set('Authorization', staff.auth).send({ headline: 'Second', subheading: 'Sub', isVisible: false, sortOrder: 1 }).expect(200)).body.slide;
    await http.put(`/admin/homepage/slides/${b.id}`).set('Authorization', staff.auth).send({ isVisible: true, linkUrl: 'https://spinhobby.com/sale' }).expect(200);
    await http.put('/admin/homepage/slides/reorder').set('Authorization', staff.auth).send({ ids: [b.id, a.id] }).expect(200);
    expect((await http.get('/homepage')).body.slides.map((s: any) => [s.headline, s.link_url])).toEqual([['Second', 'https://spinhobby.com/sale'], ['First', null]]);
    await http.put('/admin/homepage/slides/not-a-uuid').set('Authorization', staff.auth).send({}).expect(400);
    await http.delete(`/admin/homepage/slides/${a.id}`).set('Authorization', staff.auth).expect(200);
    expect((await http.get('/admin/homepage/slides').set('Authorization', staff.auth)).body.slides).toHaveLength(1);

    const ev = (await http.post('/admin/events').set('Authorization', staff.auth).send({ name: 'Otafest', city: 'Calgary', startDate: '2027-05-15', endDate: '2027-05-17' }).expect(200)).body.event;
    expect(ev).toMatchObject({ name: 'Otafest', city: 'Calgary', start_date: '2027-05-15', end_date: '2027-05-17', is_visible: true });
    await http.put(`/admin/events/${ev.id}`).set('Authorization', staff.auth).send({ name: 'Otafest 2027', startDate: '2027-05-15', endDate: '2027-05-10' })
      .expect(400, { success: false, error: 'End date must be on or after the start date.' });
    await http.post('/admin/events').set('Authorization', staff.auth).send({ name: 'Bad', startDate: 'soon' }).expect(400);
    const fixed = await http.put(`/admin/events/${ev.id}`).set('Authorization', staff.auth).send({ name: 'Otafest 2027', city: 'Calgary' }).expect(200);
    expect(fixed.body.event.name).toBe('Otafest 2027');
    expect((await http.get('/homepage')).body.events.map((e: any) => e.name)).toEqual(['Otafest 2027']);
    await http.delete(`/admin/events/${ev.id}`).set('Authorization', staff.auth).expect(200);
  });
});

describe('shop categories', () => {
  const ids: Record<string, string> = {};
  const create = (name: string, parentId?: string) =>
    http.post('/admin/categories').set('Authorization', staff.auth).send({ name, parentId: parentId ?? null });

  it('builds a tree of categories and subcategories of any depth', async () => {
    await http.post('/admin/categories').set('Authorization', shopper.auth).send({ name: 'Nope' }).expect(403);
    ids.figures = (await create('Figures').expect(200)).body.category.id;
    ids.scale = (await create('Scale Figures', ids.figures).expect(200)).body.category.id;
    ids.prize = (await create('Prize Figures', ids.figures).expect(200)).body.category.id;
    ids.limited = (await create('Limited Editions', ids.scale).expect(200)).body.category.id; // 3rd level
    ids.goods = (await create('Goods').expect(200)).body.category.id;
    await create('  scale   figures ', ids.figures).expect(409, { success: false, error: 'A category with that name already exists here.' });
    await create('Scale Figures', ids.goods).expect(200); // same name under a different parent is fine
    await create('', ids.figures).expect(400);
    await create('Orphan', '00000000-0000-4000-8000-000000000000').expect(404);
    const list = (await http.get('/admin/categories').set('Authorization', staff.auth).expect(200)).body.categories;
    expect(list.filter((c: any) => c.parentId === ids.figures).map((c: any) => [c.name, c.sortOrder])).toEqual([['Scale Figures', 0], ['Prize Figures', 1]]);
  });

  it('prevents loops and reorders siblings', async () => {
    await http.put(`/admin/categories/${ids.figures}`).set('Authorization', staff.auth).send({ parentId: ids.limited }).expect(400, { success: false, error: "A category can't be moved inside itself." });
    await http.put(`/admin/categories/${ids.figures}`).set('Authorization', staff.auth).send({ parentId: ids.figures }).expect(400);
    await http.put('/admin/categories/reorder').set('Authorization', staff.auth).send({ ids: [ids.prize, ids.scale] }).expect(200);
    const kids = (await http.get('/categories')).body.categories.filter((c: any) => c.parentId === ids.figures);
    expect(kids.map((c: any) => c.name)).toEqual(['Prize Figures', 'Scale Figures']);
  });

  it('assigns products (single and bulk) and exposes the category to the storefront', async () => {
    await http.patch('/admin/products/FIG1').set('Authorization', staff.auth).send({ category_id: 'not-a-uuid' }).expect(400);
    await http.patch('/admin/products/FIG1').set('Authorization', staff.auth).send({ category_id: ids.limited }).expect(200);
    const bulk = await http.post('/admin/products/bulk-category').set('Authorization', staff.auth).send({ ids: ['PRZ1', 'CHB1', 'NOPE'], categoryId: ids.prize }).expect(200);
    expect(bulk.body.updated).toBe(2);
    const fig = (await http.get('/square/catalog/FIG1')).body.item;
    expect(fig).toMatchObject({ category: 'Limited Editions', categoryId: ids.limited });
    const counts = Object.fromEntries((await http.get('/admin/categories').set('Authorization', staff.auth)).body.categories.map((c: any) => [c.name, c.productCount]));
    expect(counts).toMatchObject({ 'Limited Editions': 1, 'Prize Figures': 2, Figures: 0 });
    // Storefront: totals roll up into parents, and a parent filter includes its whole branch.
    const facets = (await http.get('/products/facets')).body;
    const totals = Object.fromEntries(facets.shopCategories.map((c: any) => [c.name, c.total]));
    expect(totals).toEqual({ Figures: 3, 'Scale Figures': 1, 'Limited Editions': 1, 'Prize Figures': 2 });
    expect((await http.get(`/products?categoryId=${ids.figures}&limit=60`)).body.items.map((p: any) => p.id).sort()).toEqual(['CHB1', 'FIG1', 'PRZ1']);
    expect((await http.get(`/products?categoryId=${ids.scale}`)).body.items.map((p: any) => p.id)).toEqual(['FIG1']);
    expect((await http.get('/products?q=limited%20editions')).body.items.map((p: any) => p.id)).toEqual(['FIG1']); // search matches category names
  });

  it('hides a hidden branch from storefront navigation', async () => {
    await http.put(`/admin/categories/${ids.scale}`).set('Authorization', staff.auth).send({ isVisible: false }).expect(200);
    const names = (await http.get('/homepage')).body.categories.map((c: any) => c.name);
    expect(names).toContain('Prize Figures');
    expect(names).not.toContain('Limited Editions'); // child of the hidden category
    await http.put(`/admin/categories/${ids.scale}`).set('Authorization', staff.auth).send({ isVisible: true, name: 'Scale Figures 1/7' }).expect(200);
    expect((await http.get('/categories')).body.categories.map((c: any) => c.name)).toContain('Scale Figures 1/7');
  });

  it('deletes a branch and leaves its products uncategorised', async () => {
    const res = await http.delete(`/admin/categories/${ids.figures}`).set('Authorization', staff.auth).expect(200);
    expect(res.body).toEqual({ success: true, deletedCategories: 4, uncategorisedProducts: 3 });
    expect((await http.get('/square/catalog/FIG1')).body.item).toMatchObject({ categoryId: null, category: 'Scale Figures' }); // back to the Square category
    expect((await http.get('/categories')).body.categories.map((c: any) => c.name).sort()).toEqual(['Goods', 'Scale Figures']);
  });
});

describe('hand-entered merchandise', () => {
  let itemId = '';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  it('uploads a resized photo to the public bucket', async () => {
    const storage = mockFetch({ '/storage/v1/object/product-images/': () => ({ Key: 'ok' }) });
    try {
      await http.post('/admin/uploads').set('Authorization', shopper.auth).send({ data: png.toString('base64'), contentType: 'image/png' }).expect(403);
      await http.post('/admin/uploads').set('Authorization', staff.auth).send({ data: png.toString('base64'), contentType: 'image/gif' }).expect(400, { success: false, error: 'Upload a WebP, JPEG or PNG image.' });
      const res = await http.post('/admin/uploads').set('Authorization', staff.auth)
        .send({ data: `data:image/png;base64,${png.toString('base64')}`, contentType: 'image/png', folder: 'products' }).expect(200);
      expect(res.body.url).toMatch(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/product-images\/products\/\d{4}-\d{2}\/[0-9a-f-]+\.png$/);
      expect(res.body.bytes).toBe(png.length);
      expect(storage.calls[0].url).toContain('/storage/v1/object/product-images/products/');
    } finally {
      storage.restore();
    }
  });

  it('creates a product that shows up in the storefront with stock and photos', async () => {
    await http.post('/admin/products').set('Authorization', staff.auth).send({ name: 'Keychain', priceCents: 0 }).expect(400, { success: false, error: 'Enter a price above $0.' });
    await http.post('/admin/products').set('Authorization', staff.auth).send({ name: 'Keychain', priceCents: 900, stockCount: -1 }).expect(400);
    await http.post('/admin/products').set('Authorization', staff.auth).send({ name: 'Keychain', priceCents: 900, availability: 'preorder' }).expect(400, { success: false, error: 'Pre-orders need an order-by date.' });
    await http.post('/admin/products').set('Authorization', staff.auth).send({ name: 'Keychain', priceCents: 900, imageUrls: ['http://insecure/img.png'] }).expect(400);
    const res = await http.post('/admin/products').set('Authorization', staff.auth).send({
      name: 'Acrylic Keychain — Con Exclusive', category: 'Keychains', priceCents: 1400, stockCount: 12, series: 'Spin Hobby Originals', description: 'Double-sided, 6cm.',
      imageUrls: ['https://proj.supabase.co/storage/v1/object/public/product-images/products/a.webp', 'https://proj.supabase.co/b.webp'],
    }).expect(200);
    itemId = res.body.product.id;
    expect(itemId).toMatch(/^manual-/);
    expect(res.body.product).toMatchObject({ name: 'Acrylic Keychain — Con Exclusive', category: 'Keychains', priceCents: 1400, stockCount: 12, status: 'in', series: 'Spin Hobby Originals', source: 'manual' });
    expect(res.body.product.images).toHaveLength(2);
    expect((await http.get(`/square/catalog/${itemId}`)).body.item.description).toBe('Double-sided, 6cm.');
    const listed = (await http.get('/products?category=Keychains')).body.items;
    expect(listed.map((p: any) => p.id)).toEqual([itemId]);
    const admin = (await http.get('/admin/products?limit=60').set('Authorization', staff.auth)).body.items.find((p: any) => p.id === itemId);
    expect(admin).toMatchObject({ source: 'manual' });
    expect((await http.get('/admin/products?limit=60').set('Authorization', staff.auth)).body.items.find((p: any) => p.id === 'PRZ1').source).toBe('square');
    const quote = await http.post('/cart/quote').send({ items: [{ variationId: `${itemId}-v`, quantity: 13 }], shippingMethod: 'standard', country: 'CA', province: 'AB' }).expect(200);
    expect(quote.body.warnings[0]).toMatchObject({ code: 'QTY_REDUCED' });
    expect(quote.body.lines[0]).toMatchObject({ quantity: 12, unitPriceCents: 1400 });
  });

  it('edits stock, price and photos, but only for hand-entered products', async () => {
    await http.patch('/admin/products/PRZ1/catalog').set('Authorization', staff.auth).send({ stockCount: 3 })
      .expect(400, { success: false, error: 'This product comes from Square. Edit its name, price, photos and stock in Square.' });
    await http.patch(`/admin/products/${itemId}/catalog`).set('Authorization', staff.auth).send({ stockCount: 2, priceCents: 1500, name: 'Acrylic Keychain', imageUrls: ['https://proj.supabase.co/c.webp'] }).expect(200);
    let item = (await http.get(`/square/catalog/${itemId}`)).body.item;
    expect(item).toMatchObject({ name: 'Acrylic Keychain', priceCents: 1500, stockCount: 2, status: 'low', images: ['https://proj.supabase.co/c.webp'] });
    await http.patch(`/admin/products/${itemId}/catalog`).set('Authorization', staff.auth).send({ stockCount: null }).expect(200);
    item = (await http.get(`/square/catalog/${itemId}`)).body.item;
    expect(item).toMatchObject({ stockCount: null, status: 'in' });
    await http.patch(`/admin/products/${itemId}/catalog`).set('Authorization', staff.auth).send({ stockCount: 2 }).expect(200);
    // Storefront metadata edits (featured, sale price) work on manual products too.
    await http.patch(`/admin/products/${itemId}`).set('Authorization', staff.auth).send({ compare_at_cents: 2000, is_featured: true }).expect(200);
    expect((await http.get(`/square/catalog/${itemId}`)).body.item.compareAtCents).toBe(2000);
  });

  it('sends manual products to Square checkout as named line items', async () => {
    await http.put('/admin/settings').set('Authorization', owner.auth).send({ payment_provider: 'square' }).expect(200);
    const square = mockFetch({ '/v2/orders': () => ({ order: { id: 'SQ-ORDER-2' } }), '/v2/payments': () => ({ payment: { id: 'SQ-PAY-2', status: 'COMPLETED' } }) });
    try {
      const intent = await http.post('/checkout/intent').send({ quote: { items: [{ variationId: `${itemId}-v`, quantity: 1 }, { variationId: 'PRZ1_V', quantity: 1 }], shippingMethod: 'standard', country: 'CA', province: 'AB' }, email: 'con@example.com', billing: address, shipping: address }).expect(200);
      await http.post('/square/payments').send({ orderId: intent.body.orderId, email: 'con@example.com', sourceId: 'cnon:ok' }).expect(200);
      const lines = square.calls.find((c) => c.url.endsWith('/v2/orders'))!.body.order.line_items;
      expect(lines.find((l: any) => l.name === 'Acrylic Keychain')).not.toHaveProperty('catalog_object_id');
      expect(lines.find((l: any) => l.name === 'Miku Prize Figure')).toHaveProperty('catalog_object_id', 'PRZ1_V');
    } finally {
      square.restore();
      await http.put('/admin/settings').set('Authorization', owner.auth).send({ payment_provider: 'paypal' }).expect(200);
    }
  });

  it('archives hand-entered products and refuses to archive Square ones', async () => {
    await http.delete('/admin/products/PRZ1').set('Authorization', staff.auth).expect(400);
    await http.delete(`/admin/products/${itemId}`).set('Authorization', staff.auth).expect(200);
    expect((await http.get('/products?category=Keychains')).body.items).toEqual([]);
  });
});

describe('cashier + ops', () => {
  it('requires staff and a photo', async () => {
    await http.post('/cashier/identify').expect(401);
    await http.post('/cashier/identify').set('Authorization', staff.auth).expect(400, { success: false, error: 'photo is required' });
    await http.post('/cashier/record').set('Authorization', staff.auth).field('title', 'Thing').field('price', '-1').expect(400, { success: false, error: 'price must be a positive number' });
  });

  it('enforces the monthly AI budget before calling Claude', async () => {
    await http.put('/ops/ai-usage/anthropic_cashier').set('Authorization', owner.auth).send({ warnThresholdUsd: 0, stopThresholdUsd: 0 }).expect(200);
    const res = await http.post('/cashier/identify').set('Authorization', staff.auth).attach('photo', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(429);
    expect(res.body.error).toMatch(/AI budget of \$0 reached/);
    const usage = await http.get('/ops/ai-usage').set('Authorization', owner.auth).expect(200);
    expect(usage.body.tools[0]).toMatchObject({ tool: 'anthropic_cashier', status: 'blocked' });
    await http.get('/ops/ai-usage').set('Authorization', staff.auth).expect(403);
  });

  it('identifies a photo with Claude using structured output and records the cost', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    await http.put('/ops/ai-usage/anthropic_cashier').set('Authorization', owner.auth).send({ warnThresholdUsd: 20, stopThresholdUsd: 30 }).expect(200);
    const claude = mockFetch({
      'api.anthropic.com/v1/messages': () => ({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify({ title: 'Rem Figure', description: 'Scale figure of Rem.', category: 'Bishoujo Figures', artworkCrop: { x: -1, y: 0.2, width: 5, height: 0.5, rotationDegrees: 90 } }) }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      }),
    });
    try {
      const res = await http.post('/cashier/identify').set('Authorization', staff.auth).field('condition', 'sealed')
        .attach('photo', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(200);
      expect(res.body).toEqual({ success: true, title: 'Rem Figure', description: 'Scale figure of Rem.', category: 'Bishoujo Figures', artworkCrop: { x: 0, y: 0.2, width: 1, height: 0.5, rotationDegrees: 45 } });
      const sent = claude.calls[0].body;
      expect(sent).toMatchObject({ model: 'claude-opus-5', max_tokens: 4096, fallbacks: 'default', output_config: { effort: 'low', format: { type: 'json_schema' } } });
      expect(sent.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
      expect(sent.messages[0].content[1].text).toContain('SEALED');
      await new Promise((r) => setTimeout(r, 20)); // usage is recorded without blocking the response
      const usage = (await http.get('/ops/ai-usage').set('Authorization', owner.auth)).body.tools[0];
      expect(usage.spendUsd).toBeCloseTo((1000 * 5 + 200 * 25) / 1_000_000, 6);
    } finally {
      claude.restore();
    }
  });
});
