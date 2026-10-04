import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { squareAccessToken, squareApiVersion, squareBaseUrl } from '../../config/square.config.js';
import type { ExternalJson } from '../../common/external-json.js';

/**
 * Square's REST API over plain `fetch`, for everything checkout needs: payments, orders, refunds and the
 * catalog sync. (The cashier tool's catalog edits use the official SDK in `SquareCatalogClient` instead.)
 * Every call is a POST with a JSON body; a Square error becomes an `AppError` carrying Square's own message.
 */
@Injectable()
export class SquareHttpClient {
  async request(path: string, payload: unknown, idempotencyKey?: string): Promise<ExternalJson> {
    const token = squareAccessToken();
    if (!token) throw new AppError('Square is not configured.', 503);
    const res = await fetch(`${squareBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(squareApiVersion() ? { 'Square-Version': squareApiVersion()! } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as ExternalJson;
    if (!res.ok)
      throw new AppError(body.errors?.[0]?.detail ?? 'Square rejected the request.', 502);
    return body;
  }
}
