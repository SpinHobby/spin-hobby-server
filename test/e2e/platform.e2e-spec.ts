import { afterAll, describe, expect, it } from 'vitest';
import { mockFetch } from '../support/harness.js';
import { ORIGIN, startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http } = shop;

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
        success: true,
        status: 'ok',
        checks: {
          config: { ok: true, missing: [] },
          database: { ok: true },
          schema: { ok: true, missingTables: [] },
          auth: { ok: true, password: true },
          storage: { ok: false, error: 'bucket_missing' }, // storage problems are reported but don't fail readiness
        },
        integrations: {
          paypal: 'configured',
          square: 'configured',
          email: 'configured',
          cashierAi: 'not_configured',
        },
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
    const preflight = await http
      .options('/cart/quote')
      .set('Origin', 'https://spinhobby.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://spinhobby.com');
  });
});
