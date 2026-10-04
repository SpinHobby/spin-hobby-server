import { afterEach, describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { LoginDto } from './login.dto.js';
import { OauthUrlQuery } from './oauth-url.dto.js';
import { ResetDto } from './reset.dto.js';
import { SignupDto } from './signup.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });
const query = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'query', metatype });

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

describe('LoginDto', () => {
  it('lowercases the email and keeps usernames (staging admin) as they are', async () => {
    expect(await body(LoginDto, { email: ' Boss@Shop.com ', password: 'pw' })).toMatchObject({
      email: 'boss@shop.com',
      password: 'pw',
    });
    expect(await body(LoginDto, { email: 'staging-admin', password: 'pw' })).toMatchObject({
      email: 'staging-admin',
    });
  });

  it('requires both fields, by name', async () => {
    await expect(body(LoginDto, { password: 'pw' })).rejects.toMatchObject({
      message: 'email is required.',
    });
    await expect(body(LoginDto, { email: 'a@b.co' })).rejects.toMatchObject({
      message: 'password is required.',
    });
  });
});

describe('SignupDto', () => {
  const ok = { email: 'Fan@Example.com', password: 'longenough' };

  it('cleans the email and defaults optional names to empty text', async () => {
    expect(await body(SignupDto, ok)).toMatchObject({
      email: 'fan@example.com',
      firstName: '',
      lastName: '',
    });
    expect(
      await body(SignupDto, { ...ok, firstName: `  ${'a'.repeat(100)} `, lastName: 5 }),
    ).toMatchObject({
      firstName: 'a'.repeat(80),
      lastName: '',
    });
  });

  it('keeps the messages shoppers see', async () => {
    await expect(body(SignupDto, { ...ok, email: 'nope' })).rejects.toMatchObject({
      message: 'Enter a valid email address.',
    });
    await expect(body(SignupDto, { ...ok, password: 'short' })).rejects.toMatchObject({
      message: 'Use a password with at least 8 characters.',
      status: 400,
    });
  });
});

describe('ResetDto', () => {
  it('treats redirectTo as optional', async () => {
    expect(await body(ResetDto, { email: 'a@b.co' })).toMatchObject({ redirectTo: '' });
  });

  it('only accepts our own sites or localhost as the redirect', async () => {
    const email = 'a@b.co';
    expect(
      await body(ResetDto, { email, redirectTo: 'https://spinhobby.com/reset-password' }),
    ).toMatchObject({
      redirectTo: 'https://spinhobby.com/reset-password',
    });
    expect(
      await body(ResetDto, { email, redirectTo: 'http://localhost:5173/reset' }),
    ).toMatchObject({
      redirectTo: 'http://localhost:5173/reset',
    });
    await expect(
      body(ResetDto, { email, redirectTo: 'https://evil.example/reset' }),
    ).rejects.toMatchObject({
      message: 'redirectTo is not an allowed site.',
    });
    await expect(body(ResetDto, { email, redirectTo: 'not a url' })).rejects.toMatchObject({
      message: 'Invalid redirectTo.',
    });
  });
});

describe('OauthUrlQuery', () => {
  it('accepts a known provider and an allowed redirect', async () => {
    expect(
      await query(OauthUrlQuery, { provider: 'google', redirectTo: 'https://spinhobby.com/' }),
    ).toMatchObject({ provider: 'google', redirectTo: 'https://spinhobby.com/' });
  });

  it('checks the provider before the redirect', async () => {
    await expect(
      query(OauthUrlQuery, { provider: 'myspace', redirectTo: 'https://evil.example/' }),
    ).rejects.toMatchObject({ message: 'Unknown sign-in provider.' });
    await expect(query(OauthUrlQuery, { provider: 'discord' })).rejects.toMatchObject({
      message: 'redirectTo is required.',
    });
  });
});
