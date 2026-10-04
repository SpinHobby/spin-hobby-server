import type { PGlite } from '@electric-sql/pglite';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard.js';
import { createApp, createDatabase, JWT_SECRET } from './harness.js';

let pglite: PGlite;
let app: INestApplication;
let http: ReturnType<typeof request>;

const ORIGIN = 'http://localhost:5173';
const login = () =>
  http.post('/auth/login').send({ email: 'fan@example.com', password: 'wrong-password' });

beforeAll(async () => {
  Object.assign(process.env, {
    SUPABASE_JWT_SECRET: JWT_SECRET,
    ALLOWED_ORIGINS: ORIGIN,
    THROTTLE_DISABLED: 'false',
    SQUARE_WEBHOOK_SIGNATURE_KEY: 'whsec',
    SQUARE_WEBHOOK_URL: 'https://api.spinhobby.com/webhooks/square',
  });
  delete process.env.RATE_LIMIT_PER_MINUTE;
  const db = await createDatabase();
  pglite = db.pglite;
  app = await createApp(db.driver);
  http = request(app.getHttpServer());
});

beforeEach(() => {
  app.get(RateLimitGuard).reset();
  delete process.env.RATE_LIMIT_PER_MINUTE;
});

afterAll(async () => {
  process.env.THROTTLE_DISABLED = 'true';
  await app?.close();
  await pglite?.close();
});

describe('rate limits', () => {
  it('lets ten sign-in attempts through a minute, then answers 429 with Retry-After', async () => {
    for (let i = 0; i < 10; i++) expect((await login()).status).not.toBe(429);
    const blocked = await login();
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({
      success: false,
      code: 'RATE_LIMITED',
      error: expect.stringContaining('Too many requests'),
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('applies the tighter limit to sensitive routes only', async () => {
    for (let i = 0; i < 11; i++) await login();
    expect((await http.get('/products').expect(200)).body).toBeDefined();
  });

  it('enforces a global ceiling per address', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '5';
    for (let i = 0; i < 5; i++) await http.get('/products').expect(200);
    await http.get('/products').expect(429);
  });

  it('never throttles health checks, webhooks or sample images', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    for (let i = 0; i < 8; i++) {
      await http.get('/health/live').expect(200);
      expect(
        (await http.post('/webhooks/square').set('Content-Type', 'application/json').send('{}'))
          .status,
      ).not.toBe(429);
      expect((await http.get('/sample-images/anything.svg')).status).not.toBe(429);
    }
  });

  it('can be switched off', async () => {
    process.env.THROTTLE_DISABLED = 'true';
    try {
      for (let i = 0; i < 15; i++) expect((await login()).status).not.toBe(429);
    } finally {
      process.env.THROTTLE_DISABLED = 'false';
    }
  });
});

describe('request ids', () => {
  it('generates one and returns it', async () => {
    const res = await http.get('/health/live').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps a sane caller-supplied id and replaces a hostile one', async () => {
    expect(
      (await http.get('/health/live').set('x-request-id', 'trace-abc-12345')).headers[
        'x-request-id'
      ],
    ).toBe('trace-abc-12345');
    const replaced = await http.get('/health/live').set('x-request-id', 'bad id\twith <script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('puts the id on error responses and exposes it to browsers', async () => {
    const res = await http.get('/nope').set('Origin', ORIGIN).expect(404);
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['access-control-expose-headers']).toContain('x-request-id');
  });
});

describe('security headers', () => {
  it('sends helmet defaults, hides the framework, and still lets other origins load images', async () => {
    const res = await http.get('/health/live').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['strict-transport-security']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
