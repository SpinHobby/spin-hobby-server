import { describe, expect, it } from 'vitest';
import { explainDbError } from './db-error.js';

describe('explainDbError', () => {
  it('maps connection problems to safe, actionable reasons', () => {
    expect(
      explainDbError({ code: 'ENETUNREACH', message: 'connect ENETUNREACH 2600:1f18::1:5432' }),
    ).toMatchObject({ error: 'host_unreachable' });
    expect(
      explainDbError({
        code: '28P01',
        message: 'password authentication failed for user "postgres"',
      }),
    ).toMatchObject({ error: 'password_rejected' });
    expect(explainDbError({ code: 'XX000', message: 'Tenant or user not found' })).toMatchObject({
      error: 'pooler_user_wrong',
    });
    expect(
      explainDbError({ message: 'self-signed certificate in certificate chain' }),
    ).toMatchObject({ error: 'ssl_error' });
    expect(explainDbError({ code: 'CONFIG_MISSING', message: 'x' })).toMatchObject({
      error: 'not_configured',
    });
    expect(
      explainDbError({ code: 'ZZZ', message: 'postgresql://user:secret@host/db exploded' }),
    ).toEqual({
      error: 'unknown_ZZZ',
      hint: 'See the service logs for details.',
      detail: '<url> exploded',
    });
    expect(
      explainDbError({
        code: 'XX000',
        message: 'Circuit breaker open: Too many authentication errors',
      }),
    ).toMatchObject({ error: 'blocked_after_failed_logins' });
    expect(
      explainDbError({ code: 'XX000', message: 'Max client connections reached' }),
    ).toMatchObject({ error: 'too_many_connections' });
  });
});
