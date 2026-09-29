import { describe, expect, it } from 'vitest';
import { bootstrapRole } from '../auth/auth.service.js';
import { sanitizeArtworkCrop } from '../cashier/identify.service.js';
import { WebhooksController } from '../webhooks/webhooks.controller.js';
import { likePattern, positiveInteger, stringValue } from './validation.js';

describe('validation helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
  it('keeps the edge function messages', () => {
    expect(() => stringValue('  ', 'title')).toThrow('title is required.');
    expect(() => positiveInteger(100, 'quantity')).toThrow('quantity must be between 1 and 99.');
    expect(positiveInteger('3', 'quantity')).toBe(3);
  });
});

describe('bootstrapRole', () => {
  it('promotes listed emails and never demotes', () => {
    process.env.OWNER_EMAILS = 'Boss@Shop.com';
    process.env.STAFF_EMAILS = 'help@shop.com';
    expect(bootstrapRole('boss@shop.com', 'customer')).toBe('owner');
    expect(bootstrapRole('help@shop.com', 'customer')).toBe('staff');
    expect(bootstrapRole('help@shop.com', 'owner')).toBe('owner');
    expect(bootstrapRole('fan@shop.com', 'staff')).toBe('staff');
  });
});

describe('square webhook signature', () => {
  it('rejects missing config and wrong signatures', () => {
    expect(WebhooksController.squareSignatureValid('{}', 'x', undefined, 'u')).toBe(false);
    expect(WebhooksController.squareSignatureValid('{}', 'AAAA', 'key', 'https://x')).toBe(false);
  });
});

describe('sanitizeArtworkCrop', () => {
  it('drops junk and clamps boxes into the photo', () => {
    expect(sanitizeArtworkCrop(null)).toBeUndefined();
    expect(sanitizeArtworkCrop({ x: 'a', y: 0, width: 1, height: 1 })).toBeUndefined();
    expect(sanitizeArtworkCrop({ x: 0.9, y: 0.9, width: 1, height: 1, rotationDegrees: -90 })).toEqual({ x: 0.9, y: 0.9, width: expect.closeTo(0.1, 6), height: expect.closeTo(0.1, 6), rotationDegrees: -45 });
  });
});
