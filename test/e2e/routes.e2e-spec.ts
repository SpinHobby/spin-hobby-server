import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createDatabase } from '../support/harness.js';

/**
 * The public surface of the API: every route with who may call it and its rate limit.
 * Refactors must not change this list; if a route is added, removed or re-secured on purpose,
 * update the snapshot in the same commit so the change is visible in review.
 */
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
const joinPath = (...parts: string[]) =>
  '/' +
  parts
    .map((p) => p.replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/');

function listRoutes(app: INestApplication): string[] {
  const routes: string[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata('path', controller) ?? '');
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata('method', handler);
        if (method === undefined) continue;
        const path = joinPath(base, String(Reflect.getMetadata('path', handler) ?? ''));
        const access =
          Reflect.getMetadata('spinhobby:access', handler) ??
          Reflect.getMetadata('spinhobby:access', controller) ??
          'public';
        const rate = Reflect.getMetadata('spinhobby:rate-limit', handler) as
          { limit: number; windowMs: number } | undefined;
        const skip =
          Reflect.getMetadata('spinhobby:rate-limit-skip', handler) ??
          Reflect.getMetadata('spinhobby:rate-limit-skip', controller);
        routes.push(
          `${METHODS[method]} ${path} [${access}]${rate ? ` limit ${rate.limit}/${rate.windowMs / 1000}s` : ''}${skip ? ' no-limit' : ''}`,
        );
      }
    }
  }
  return routes.sort();
}

const EXPECTED: string[] = [
  'DELETE /admin/categories/:id [staff]',
  'DELETE /admin/events/:id [staff]',
  'DELETE /admin/homepage/slides/:id [staff]',
  'DELETE /admin/products/:id [staff]',
  'DELETE /admin/products/:id/photos/:imageId [staff]',
  'DELETE /wishlist/:itemId [user]',
  'GET /admin/catalog [staff]',
  'GET /admin/categories [staff]',
  'GET /admin/dashboard [staff]',
  'GET /admin/events [staff]',
  'GET /admin/homepage/slides [staff]',
  'GET /admin/orders [staff]',
  'GET /admin/orders/:id [staff]',
  'GET /admin/orders/:id/packing-slip [staff]',
  'GET /admin/photo-proxy [staff]',
  'GET /admin/products [staff]',
  'GET /admin/products/:id/photos [staff]',
  'GET /admin/products/by-barcode/:code [staff]',
  'GET /admin/series [staff]',
  'GET /admin/settings [staff]',
  'GET /admin/square/readiness [staff]',
  'GET /admin/tax-rates [owner]',
  'GET /auth/me [user]',
  'GET /auth/oauth-url [public]',
  'GET /auth/providers [public]',
  'GET /cashier/item/:id [staff]',
  'GET /cashier/search [staff]',
  'GET /categories [public]',
  'GET /checkout/config [public]',
  'GET /health [public] no-limit',
  'GET /health/live [public] no-limit',
  'GET /homepage [public]',
  'GET /ops/ai-usage [owner]',
  'GET /ops/database [owner]',
  'GET /orders [user]',
  'GET /orders/:id [user]',
  'GET /orders/lookup [public]',
  'GET /products [public]',
  'GET /products/facets [public]',
  'GET /products/new-in-stock [public]',
  'GET /products/preorders [public]',
  'GET /products/ranking [public]',
  'GET /sample-images/:file [public] no-limit',
  'GET /square/catalog [public]',
  'GET /square/catalog/:id [public]',
  'GET /square/config [public]',
  'GET /square/display-categories [public]',
  'GET /square/inventory [public]',
  'GET /wishlist [user]',
  'PATCH /admin/products/:id [staff]',
  'PATCH /admin/products/:id/catalog [staff]',
  'POST /admin/categories [staff]',
  'POST /admin/events [staff]',
  'POST /admin/homepage/slides [staff]',
  'POST /admin/homepage/slides/reorder [staff]',
  'POST /admin/orders/:id/refund [owner]',
  'POST /admin/orders/:id/ship [staff]',
  'POST /admin/products [staff]',
  'POST /admin/products/:id/add-stock [staff]',
  'POST /admin/products/:id/notify-restock [staff]',
  'POST /admin/products/:id/photos [staff]',
  'POST /admin/products/:id/transfer-to-square [owner]',
  'POST /admin/products/bulk-category [staff]',
  'POST /admin/products/quick-add [staff]',
  'POST /admin/series [staff]',
  'POST /admin/square/sync [owner]',
  'POST /admin/uploads [staff]',
  'POST /alerts [public]',
  'POST /auth/login [public] limit 10/60s',
  'POST /auth/logout [user]',
  'POST /auth/password [user] limit 10/60s',
  'POST /auth/refresh [public] limit 30/60s',
  'POST /auth/reset [public] limit 5/3600s',
  'POST /auth/signup [public]',
  'POST /cart/quote [public] limit 60/60s',
  'POST /cashier/identify [staff]',
  'POST /cashier/polish [staff]',
  'POST /cashier/record [staff]',
  'POST /checkout/intent [public] limit 10/60s',
  'POST /paypal/capture [public] limit 20/60s',
  'POST /square-sync [public]',
  'POST /square/payments [public] limit 10/60s',
  'POST /webhooks/paypal [public] no-limit',
  'POST /webhooks/square [public] no-limit',
  'POST /wishlist [user]',
  'PUT /admin/categories/:id [staff]',
  'PUT /admin/categories/reorder [staff]',
  'PUT /admin/events/:id [staff]',
  'PUT /admin/homepage/slides/:id [staff]',
  'PUT /admin/homepage/slides/reorder [staff]',
  'PUT /admin/products/:id/photos [staff]',
  'PUT /admin/products/:id/visibility [staff]',
  'PUT /admin/products/front-page-order [staff]',
  'PUT /admin/series/:id [staff]',
  'PUT /admin/settings [owner]',
  'PUT /admin/tax-rates [owner]',
  'PUT /cashier/item/:id [staff]',
  'PUT /ops/ai-usage/:tool [owner]',
];

let app: INestApplication;
beforeAll(async () => {
  const { driver } = await createDatabase();
  app = await createApp(driver);
});
afterAll(async () => {
  await app?.close();
});

describe('route table', () => {
  it('has not changed', () => {
    const actual = listRoutes(app);
    expect(actual).toEqual(EXPECTED);
  });
});
