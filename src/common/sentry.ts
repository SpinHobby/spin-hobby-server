import { Logger } from '@nestjs/common';
import { env } from '../config/env.js';

interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: Record<string, unknown>): void;
}
let sentry: SentryLike | null = null;

/**
 * Error tracking is opt-in: it switches on only when SENTRY_DSN is set, and the SDK is loaded lazily so the
 * app neither needs nor installs it otherwise (add it with `npm i @sentry/node` when a Sentry project exists).
 */
export async function initSentry() {
  const dsn = env('SENTRY_DSN');
  if (!dsn) return;
  const logger = new Logger('Sentry');
  try {
    const name = '@sentry/node';
    const mod = (await import(name)) as SentryLike;
    mod.init({
      dsn,
      environment: env('APP_ENV') ?? env('NODE_ENV') ?? 'production',
      tracesSampleRate: 0,
    });
    sentry = mod;
    logger.log('Error reporting enabled.');
  } catch {
    logger.warn(
      'SENTRY_DSN is set but @sentry/node could not be loaded; run `npm i @sentry/node`. Errors are logged only.',
    );
  }
}

export function reportError(error: unknown, requestId?: string) {
  sentry?.captureException(error, requestId ? { tags: { requestId } } : undefined);
}
