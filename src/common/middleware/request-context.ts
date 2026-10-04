import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestLoggingEnabled } from '../../config/app.config.js';

const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Tags every request with an id (reusing a sane incoming one), echoes it back, and logs one line when it finishes. */
export function requestContext() {
  const logger = new Logger('Http');
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    if (requestLoggingEnabled()) {
      const started = Date.now();
      res.on('finish', () => {
        const path = req.originalUrl.split('?')[0]; // never log query strings: they can carry tokens
        if (path.endsWith('/health/live')) return;
        logger.log(
          `${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms ip=${req.ip} id=${id}`,
        );
      });
    }
    next();
  };
}
