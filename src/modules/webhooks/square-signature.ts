import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Square signs "notification URL + raw body" with HMAC-SHA256 and sends it base64-encoded in the
 * `x-square-hmacsha256-signature` header. Missing configuration or a missing header is never valid.
 */
export function squareSignatureValid(
  raw: string,
  signature: string | undefined,
  key: string | undefined,
  url: string | undefined,
): boolean {
  if (!signature || !key || !url) return false;
  const expected = createHmac('sha256', key)
    .update(url + raw)
    .digest();
  const given = Buffer.from(signature, 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
