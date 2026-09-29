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

import { explainDbError } from '../health/health.controller.js';

describe('explainDbError', () => {
  it('maps connection problems to safe, actionable reasons', () => {
    expect(explainDbError({ code: 'ENETUNREACH', message: 'connect ENETUNREACH 2600:1f18::1:5432' })).toMatchObject({ error: 'host_unreachable' });
    expect(explainDbError({ code: '28P01', message: 'password authentication failed for user "postgres"' })).toMatchObject({ error: 'password_rejected' });
    expect(explainDbError({ code: 'XX000', message: 'Tenant or user not found' })).toMatchObject({ error: 'pooler_user_wrong' });
    expect(explainDbError({ message: 'self-signed certificate in certificate chain' })).toMatchObject({ error: 'ssl_error' });
    expect(explainDbError({ code: 'CONFIG_MISSING', message: 'x' })).toMatchObject({ error: 'not_configured' });
    expect(explainDbError({ code: 'ZZZ', message: 'postgresql://user:secret@host/db exploded' })).toEqual({ error: 'unknown_ZZZ', hint: 'See the service logs for details.', detail: '<url> exploded' });
    expect(explainDbError({ code: 'XX000', message: 'Circuit breaker open: Too many authentication errors' })).toMatchObject({ error: 'blocked_after_failed_logins' });
    expect(explainDbError({ code: 'XX000', message: 'Max client connections reached' })).toMatchObject({ error: 'too_many_connections' });
  });
});
