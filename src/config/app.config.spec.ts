import { afterEach, describe, expect, it } from 'vitest';
import { originAllowed, shopAssistantEnabled } from './app.config.js';

describe('originAllowed', () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
  });

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

describe('shopAssistantEnabled', () => {
  const keep = { ...process.env };
  afterEach(() => {
    process.env = { ...keep };
  });
  const with_ = (vars: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vars))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    return shopAssistantEnabled();
  };

  it('is on locally and on staging (which also runs as NODE_ENV=production), off on the live site, unless SHOP_ASSISTANT says', () => {
    expect(with_({ NODE_ENV: 'development', APP_ENV: undefined, SHOP_ASSISTANT: undefined })).toBe(
      true,
    );
    expect(with_({ NODE_ENV: 'production', APP_ENV: 'staging', SHOP_ASSISTANT: undefined })).toBe(
      true,
    );
    expect(with_({ NODE_ENV: 'production', APP_ENV: undefined, SHOP_ASSISTANT: undefined })).toBe(
      false,
    );
    expect(with_({ NODE_ENV: 'production', APP_ENV: undefined, SHOP_ASSISTANT: 'on' })).toBe(true);
    expect(with_({ NODE_ENV: 'production', APP_ENV: 'staging', SHOP_ASSISTANT: 'off' })).toBe(
      false,
    );
  });
});
