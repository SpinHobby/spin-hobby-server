import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from './errors.js';
import { reportError } from './sentry.js';

/** Every error leaves as { success: false, error, code? } - the shape the storefront and admin expect. */
@Catch()
export class JsonErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof AppError) {
      res.status(exception.status).json({
        success: false,
        error: exception.message,
        ...(exception.code ? { code: exception.code } : {}),
        ...exception.extra,
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        status === 404
          ? 'Route not found.'
          : typeof body === 'string'
            ? body
            : ((body as any)?.message ?? exception.message);
      res.status(status).json({
        success: false,
        error: Array.isArray(message) ? message.join(' ') : String(message),
      });
      return;
    }
    // Postgres constraint messages are useful to staff but not safe to echo verbatim; log them instead.
    const requestId = res.locals?.requestId as string | undefined;
    this.logger.error(
      `${requestId ? `[${requestId}] ` : ''}${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
    );
    reportError(exception, requestId);
    res.status(500).json({
      success: false,
      error: 'An unexpected server error occurred.',
      ...(requestId ? { requestId } : {}),
    });
  }
}
