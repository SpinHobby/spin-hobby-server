import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addressParts, EmailService, mayEmail } from './email.service.js';

const KEYS = [
  'APP_ENV',
  'EMAIL_ALLOWLIST',
  'OWNER_EMAILS',
  'STAFF_EMAILS',
  'MAIL_TRANSPORT',
  'MAILPIT_URL',
  'RESEND_API_KEY',
  'FROM_EMAIL',
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('who real email may reach', () => {
  it('reaches everyone in production', () => {
    expect(mayEmail('customer@gmail.com')).toBe(true);
  });

  it('on staging, reaches only the allow-list, owners and staff', () => {
    process.env.APP_ENV = 'staging';
    process.env.EMAIL_ALLOWLIST = 'aidi@example.com, @spinhobby.com';
    process.env.OWNER_EMAILS = 'boss@gmail.com';
    expect(mayEmail('customer@gmail.com')).toBe(false);
    expect(mayEmail('Aidi@Example.com')).toBe(true);
    expect(mayEmail('anyone@spinhobby.com')).toBe(true);
    expect(mayEmail('boss@gmail.com')).toBe(true);
    expect(mayEmail('x@notspinhobby.com')).toBe(false);
  });

  it('on staging with no list, reaches only owners and staff', () => {
    process.env.APP_ENV = 'staging';
    process.env.STAFF_EMAILS = 'jay@example.com';
    expect(mayEmail('jay@example.com')).toBe(true);
    expect(mayEmail('hana@example.com')).toBe(false);
  });
});

describe('sending', () => {
  it('reads a From line', () => {
    expect(addressParts('Spin Hobby <shop@spinhobby.com>')).toEqual({
      Name: 'Spin Hobby',
      Email: 'shop@spinhobby.com',
    });
    expect(addressParts('shop@spinhobby.com')).toEqual({ Name: '', Email: 'shop@spinhobby.com' });
  });

  it('drops local email into Mailpit, never Resend', async () => {
    process.env.MAIL_TRANSPORT = 'mailpit';
    process.env.MAILPIT_URL = 'http://localhost:9999/';
    process.env.RESEND_API_KEY = 're_live_should_not_be_used';
    process.env.FROM_EMAIL = 'Spin Hobby <shop@spinhobby.com>';
    const calls: { url: string; body: { HTML: string } & Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{"ID":"1"}', { status: 200 });
    });
    const email = new EmailService();
    expect(email.configured).toBe(true);
    expect(await email.send('hana@example.com', 'Hello', '<p>Hi</p>')).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://localhost:9999/api/v1/send');
    expect(calls[0].body).toMatchObject({
      From: { Name: 'Spin Hobby', Email: 'shop@spinhobby.com' },
      To: [{ Email: 'hana@example.com' }],
      Subject: 'Hello',
    });
    expect(calls[0].body.HTML).toContain('<p>Hi</p>');
  });

  it('says so (and sends nothing) when Mailpit is not running', async () => {
    process.env.MAIL_TRANSPORT = 'mailpit';
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await new EmailService().send('hana@example.com', 'Hello', '<p>Hi</p>')).toBe(false);
  });

  it('on staging, holds back email to a customer and sends to the team', async () => {
    process.env.APP_ENV = 'staging';
    process.env.EMAIL_ALLOWLIST = '@spinhobby.com';
    process.env.RESEND_API_KEY = 're_test';
    process.env.FROM_EMAIL = 'shop@spinhobby.com';
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200 });
    });
    const email = new EmailService();
    expect(await email.send('customer@gmail.com', 'Your order', '<p>x</p>')).toBe(true);
    expect(urls).toEqual([]);
    expect(await email.send('jay@spinhobby.com', 'Your order', '<p>x</p>')).toBe(true);
    expect(urls).toEqual(['https://api.resend.com/emails']);
  });

  it('is off without a key or a transport', () => {
    expect(new EmailService().configured).toBe(false);
    process.env.MAIL_TRANSPORT = 'off';
    process.env.RESEND_API_KEY = 're_test';
    process.env.FROM_EMAIL = 'shop@spinhobby.com';
    expect(new EmailService().configured).toBe(false);
  });
});
