import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { requestContext } from './common/middleware/request-context.js';
import { AppValidationPipe } from './common/validation/validation.pipe.js';
import { apiPrefix, isProduction, originAllowed } from './config/app.config.js';
import { localUploadDir } from './config/storage.config.js';

/** Shared by main.ts and the e2e tests so both run the exact same HTTP stack. */
export function configureApp(app: INestApplication) {
  // Base64 photo uploads (already resized in the browser) need more than the 100 kB default.
  (app as NestExpressApplication).useBodyParser('json', { limit: '8mb' });
  app.use(requestContext());
  // The storefront loads sample images from this origin, so the default same-origin resource policy would block them.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Outside production, any localhost port may call the API (Vite picks ports dynamically).
  const localDev = !isProduction();
  const allowed = (origin: string) =>
    originAllowed(origin) ||
    (localDev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  // Browsers on unknown origins are refused outright (requests without an Origin header, like webhooks, pass).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !allowed(origin)) {
      res.status(403).json({ success: false, error: 'Origin is not allowed.' });
      return;
    }
    next();
  });
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) =>
      cb(null, !origin || allowed(origin)),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type', 'idempotency-key'],
    exposedHeaders: ['x-request-id', 'retry-after'],
    maxAge: 86400,
  });
  const prefix = apiPrefix();
  if (prefix) app.setGlobalPrefix(prefix.replace(/^\/|\/$/g, ''));
  if (localDev) {
    // Dev-only photo uploads (StorageService falls back to disk without Supabase Storage).
    (app as NestExpressApplication).useStaticAssets(localUploadDir(), {
      prefix: '/uploads',
      maxAge: '1h',
    });
  }
  // Request bodies are checked against their DTO class (see src/common/validation).
  app.useGlobalPipes(new AppValidationPipe());
  app.enableShutdownHooks();
  return app;
}
