import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkEnvironment, validateEnvironment } from './validate-env.js';

const SAVED = { ...process.env };
beforeEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
});
afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, SAVED);
});

describe('checkEnvironment', () => {
  it('has nothing to say about an empty environment (every integration is optional)', () => {
    expect(checkEnvironment()).toEqual([]);
  });

  it('accepts a normal production-like setup', () => {
    Object.assign(process.env, {
      PORT: '8080',
      DATABASE_URL: 'postgresql://u:p@db.example.com:5432/postgres',
      SQUARE_ENVIRONMENT: 'production',
      SQUARE_ACCESS_TOKEN: 'x',
      SQUARE_LOCATION_ID: 'L1',
      PAYPAL_ENV: 'live',
      SUPABASE_URL: 'https://abc.supabase.co',
      ORDER_HOLD_MINUTES: '45',
    });
    expect(checkEnvironment()).toEqual([]);
  });

  it('treats an unusable port as fatal', () => {
    Object.assign(process.env, { PORT: 'eighty' });
    const problems = checkEnvironment();
    expect(problems.map((p) => [p.name, p.fatal])).toEqual([['PORT', true]]);
    expect(() => validateEnvironment(() => {})).toThrow(/PORT is "eighty"/);
  });

  it('warns, without failing, about values that fall back to a default', () => {
    Object.assign(process.env, {
      SQUARE_ENVIRONMENT: 'prod',
      ORDER_HOLD_MINUTES: '0',
      SQUARE_SYNC_RETIRE_MAX_RATIO: '2',
      STOREFRONT_URL: 'spinhobby.com',
      DATABASE_URL: 'not a url',
    });
    const warnings: string[] = [];
    expect(() => validateEnvironment((m) => warnings.push(m))).not.toThrow();
    expect(warnings).toHaveLength(5);
    expect(warnings[0]).toContain('SQUARE_ENVIRONMENT is "prod"');
  });

  it('flags a Square token without a location, and dev login in production', () => {
    Object.assign(process.env, {
      SQUARE_ACCESS_TOKEN: 'x',
      NODE_ENV: 'production',
      AUTH_DEV_LOGIN: 'true',
    });
    expect(checkEnvironment().map((p) => p.name)).toEqual(['SQUARE_LOCATION_ID', 'AUTH_DEV_LOGIN']);
  });
});
