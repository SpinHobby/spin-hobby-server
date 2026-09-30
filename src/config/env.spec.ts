import { afterEach, describe, expect, it } from 'vitest';
import { originAllowed } from './env.js';

describe('originAllowed', () => {
  afterEach(() => { delete process.env.ALLOWED_ORIGINS; });

  it('always allows the storefront and exact ALLOWED_ORIGINS entries', () => {
    process.env.ALLOWED_ORIGINS = 'https://staging--spinhobby.netlify.app';
    expect(originAllowed('https://spinhobby.com')).toBe(true);
    expect(originAllowed('https://staging--spinhobby.netlify.app')).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
  });

  it('matches one subdomain label for * entries and nothing more', () => {
    process.env.ALLOWED_ORIGINS = 'https://*--spinhobby.netlify.app';
    expect(originAllowed('https://deploy-preview-12--spinhobby.netlify.app')).toBe(true);
    expect(originAllowed('https://a.b--spinhobby.netlify.app')).toBe(false);
    expect(originAllowed('https://x--spinhobby.netlify.app.evil.com')).toBe(false);
    expect(originAllowed('https://x--spinhobbyXnetlify.app')).toBe(false);
  });
});
