import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { allowedOrigins, env } from './config/env.js';

/** Shared by main.ts and the e2e tests so both run the exact same HTTP stack. */
export function configureApp(app: INestApplication) {
  const origins = allowedOrigins();
  // Same rule as the edge function: browsers on unknown origins are refused outright.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) {
      res.status(403).json({ success: false, error: 'Origin is not allowed.' });
      return;
    }
    next();
  });
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'x-client-info', 'apikey', 'content-type', 'idempotency-key'],
    maxAge: 86400,
  });
  const prefix = env('API_PREFIX');
  if (prefix) app.setGlobalPrefix(prefix.replace(/^\/|\/$/g, ''));
  app.enableShutdownHooks();
  return app;
}
