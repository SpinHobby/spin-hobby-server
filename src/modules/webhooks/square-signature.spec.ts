import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { squareSignatureValid } from './square-signature.js';

describe('squareSignatureValid', () => {
  const sign = (url: string, raw: string, key: string) =>
    createHmac('sha256', key)
      .update(url + raw)
      .digest('base64');

  it('accepts the signature Square would send', () => {
    const raw = '{"event_id":"e1"}';
    const url = 'https://api.example.com/webhooks/square';
    expect(squareSignatureValid(raw, sign(url, raw, 'key'), 'key', url)).toBe(true);
  });

  it('rejects missing config and wrong signatures', () => {
    expect(squareSignatureValid('{}', 'x', undefined, 'u')).toBe(false);
    expect(squareSignatureValid('{}', 'AAAA', 'key', 'https://x')).toBe(false);
    expect(squareSignatureValid('{}', undefined, 'key', 'https://x')).toBe(false);
  });

  it('rejects a body that was changed after signing, or a different URL', () => {
    const url = 'https://api.example.com/webhooks/square';
    const signature = sign(url, '{"a":1}', 'key');
    expect(squareSignatureValid('{"a":2}', signature, 'key', url)).toBe(false);
    expect(squareSignatureValid('{"a":1}', signature, 'key', 'https://other.example.com/')).toBe(
      false,
    );
  });
});
