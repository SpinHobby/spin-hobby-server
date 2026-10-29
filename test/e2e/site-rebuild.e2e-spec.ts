import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SiteRebuildService } from '../../src/modules/catalog/site-rebuild.service.js';
import { createApp, createDatabase, mockFetch, seedProduct } from '../support/harness.js';

const HOOK = 'https://api.netlify.com/build_hooks/test-hook';
const { pglite, driver } = await createDatabase();
const app = await createApp(driver);
const rebuild = app.get(SiteRebuildService);
const hour = 3_600_000;

beforeAll(async () => {
  await seedProduct(pglite, {
    id: 'FIG1',
    name: 'Miku Figure',
    category: 'Figures',
    priceCents: 5000,
    stock: 4,
  });
});
afterAll(async () => {
  delete process.env.SITE_BUILD_HOOK_URL;
  await app.close();
  await pglite.close();
});

/** Runs a check with the hook answering `status`; returns the result and whether the hook was called. */
async function check(at: Date, status = 200) {
  const hook = mockFetch({ build_hooks: () => new Response('', { status }) });
  try {
    const result = await rebuild.check(at);
    return { result, called: hook.calls.filter((c) => c.url === HOOK).length };
  } finally {
    hook.restore();
  }
}

describe('website rebuilds', () => {
  it('does nothing without a build hook', async () => {
    expect(await check(new Date())).toEqual({ result: 'off', called: 0 });
  });

  it('asks once, then again only after products change and enough time has passed', async () => {
    process.env.SITE_BUILD_HOOK_URL = HOOK;
    const t0 = new Date('2026-10-29T12:00:00Z');
    expect(await check(t0)).toEqual({ result: 'requested', called: 1 });
    expect(await check(new Date(t0.getTime() + hour))).toEqual({ result: 'unchanged', called: 0 });

    await pglite.query(
      "update public.catalog_variations set price_cents = 4500 where square_item_id = 'FIG1'",
    );
    expect(await check(new Date(t0.getTime() + 2 * hour))).toEqual({
      result: 'waiting',
      called: 0,
    });
    expect(await check(new Date(t0.getTime() + 7 * hour))).toEqual({
      result: 'requested',
      called: 1,
    });
  });

  it('notices a new product', async () => {
    const before = await rebuild.fingerprint();
    await seedProduct(pglite, {
      id: 'PLU1',
      name: 'Plush',
      category: 'Plushies',
      priceCents: 2000,
      stock: 2,
    });
    expect(await rebuild.fingerprint()).not.toBe(before);
  });

  it('tries again next time when Netlify refuses', async () => {
    const later = new Date('2026-10-30T12:00:00Z');
    expect(await check(later, 500)).toEqual({ result: 'failed', called: 1 });
    expect(await check(later)).toEqual({ result: 'requested', called: 1 });
  });
});
