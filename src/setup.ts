import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { allowedOrigins, env } from './config/env.js';

/** Shared by main.ts and the e2e tests so both run the exact same HTTP stack. */
export function configureApp(app: INestApplication) {
  // Base64 photo uploads (already resized in the browser) need more than the 100 kB default.
  (app as NestExpressApplication).useBodyParser('json', { limit: '8mb' });
  const origins = allowedOrigins();
  // Outside production, any localhost port may call the API (Vite picks ports dynamically).
  const localDev = env('NODE_ENV') !== 'production';
  const allowed = (origin: string) => origins.includes(origin) || (localDev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  // Same rule as the edge function: browsers on unknown origins are refused outright.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !allowed(origin)) {
      res.status(403).json({ success: false, error: 'Origin is not allowed.' });
      return;
    }
    next();
  });
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => cb(null, !origin || allowed(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type', 'idempotency-key'],
    maxAge: 86400,
  });
  const prefix = env('API_PREFIX');
  if (prefix) app.setGlobalPrefix(prefix.replace(/^\/|\/$/g, ''));
  app.enableShutdownHooks();
  return app;
}
