import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnerOrSyncSecretGuard } from './owner-or-sync-secret.guard.js';

const guard = new OwnerOrSyncSecretGuard();
const context = (request: object) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;
const call = (headers: Record<string, string> = {}, user?: { role: string } | null) =>
  guard.canActivate(context({ headers, user }));

describe('OwnerOrSyncSecretGuard', () => {
  beforeEach(() => {
    process.env.SQUARE_SYNC_TRIGGER_SECRET = 'cron-secret';
  });
  afterEach(() => {
    delete process.env.SQUARE_SYNC_TRIGGER_SECRET;
  });

  it('lets the owner in without a secret', () => {
    expect(call({}, { role: 'owner' })).toBe(true);
  });

  it('lets a scheduled job in with the right secret', () => {
    expect(call({ 'x-square-sync-secret': 'cron-secret' })).toBe(true);
  });

  it('turns away everyone else with a 403', () => {
    for (const attempt of [
      () => call(),
      () => call({ 'x-square-sync-secret': 'wrong-secret' }),
      () => call({ 'x-square-sync-secret': 'short' }),
      () => call({}, { role: 'staff' }),
      () => call({}, { role: 'customer' }),
      () => call({}, null),
    ]) {
      expect(attempt).toThrowError(/permission to start a Square sync/);
    }
  });

  it('never accepts a secret when none is configured (an empty header must not match)', () => {
    delete process.env.SQUARE_SYNC_TRIGGER_SECRET;
    expect(() => call({ 'x-square-sync-secret': '' })).toThrowError(/permission/);
    expect(() => call({ 'x-square-sync-secret': 'undefined' })).toThrowError(/permission/);
  });
});
