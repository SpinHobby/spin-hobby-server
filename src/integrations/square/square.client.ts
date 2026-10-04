import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { env, squareEnvIsProduction } from '../../config/env.js';

export const squareBase = () =>
  squareEnvIsProduction() ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

/** Thin REST client for the Square endpoints checkout, refunds and catalog sync use. */
@Injectable()
export class SquareClient {
  async request(path: string, payload: unknown, idempotencyKey?: string): Promise<any> {
    const token = env('SQUARE_ACCESS_TOKEN');
    if (!token) throw new AppError('Square is not configured.', 503);
    const res = await fetch(`${squareBase()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(env('SQUARE_API_VERSION') ? { 'Square-Version': env('SQUARE_API_VERSION')! } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok)
      throw new AppError(body.errors?.[0]?.detail ?? 'Square rejected the request.', 502);
    return body;
  }
}
