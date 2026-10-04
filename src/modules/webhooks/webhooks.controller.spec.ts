import { describe, expect, it } from 'vitest';
import { WebhooksController } from './webhooks.controller.js';

describe('square webhook signature', () => {
  it('rejects missing config and wrong signatures', () => {
    expect(WebhooksController.squareSignatureValid('{}', 'x', undefined, 'u')).toBe(false);
    expect(WebhooksController.squareSignatureValid('{}', 'AAAA', 'key', 'https://x')).toBe(false);
  });
});
