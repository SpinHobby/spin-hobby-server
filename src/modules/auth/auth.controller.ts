import { Body, Controller, Get, HttpCode, Ip, Logger, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SignJWT } from 'jose';
import { Access } from './access.js';
import { AppError } from '../../common/errors.js';
import { RateLimit, RateLimiter } from '../../common/guards/rate-limit.guard.js';
import { jsonBody, stringValue } from '../../common/validation.js';
import { env, envList, originAllowed } from '../../config/env.js';
import { Db } from '../../database/db.service.js';
import { AuthService } from './auth.service.js';
import {
  isStagingAdminLogin,
  secretsMatch,
  stagingAdmin,
  type StagingAdmin,
} from './staging-admin.js';

type Provider = 'google' | 'discord';
const PROVIDERS: Provider[] = ['google', 'discord'];

function supabase() {
  const url = env('SUPABASE_URL')?.replace(/\/$/, '');
  const key = env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY');
  return url && key ? { url, key } : null;
}

function serviceKey() {
  return env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
}

/** Sign-ups per IP address per window; keeps bots from mass-creating accounts. */
const signupLimiter = new RateLimiter();
export function resetSignupLimits() {
  signupLimiter.reset();
}
const allowSignup = (ip: string) => signupLimiter.hit(ip, 5, 60 * 60 * 1000).allowed;

/** Local development only: sign in as a seeded account without Supabase (see scripts/dev-local.mjs). */
function devLoginEnabled() {
  return (
    env('NODE_ENV') !== 'production' &&
    env('AUTH_DEV_LOGIN') === 'true' &&
    Boolean(env('SUPABASE_JWT_SECRET'))
  );
}

/** Only ever redirect to an allow-listed site or localhost (used for OAuth and recovery links alike). */
function validateRedirect(target: string): string {
  let origin: string;
  try {
    origin = new URL(target).origin;
  } catch {
    throw new AppError('Invalid redirectTo.');
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!originAllowed(origin) && !local) throw new AppError('redirectTo is not an allowed site.');
  return target;
}

/**
 * Sign-in for the storefront and admin. The browser only talks to this API; this API talks to
 * Supabase Auth, so no Supabase keys or SDK are needed in the frontend.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly db: Db,
  ) {}

  /** Which sign-in methods to show. `username: true` means the email field also accepts the staging admin username. */
  @Get('providers')
  async providers() {
    if (devLoginEnabled())
      return {
        success: true,
        password: true,
        signup: false,
        google: false,
        discord: false,
        dev: true,
      };
    const admin = stagingAdmin();
    const sb = supabase();
    if (!sb)
      return { success: true, password: false, signup: false, google: false, discord: false };
    const res = await fetch(`${sb.url}/auth/v1/settings`, { headers: { apikey: sb.key } }).catch(
      () => null,
    );
    const settings = res?.ok
      ? ((await res.json()) as { external?: Record<string, boolean> })
      : { external: {} };
    const password = Boolean(settings.external?.email);
    return {
      success: true,
      password: password || Boolean(admin),
      signup: password && Boolean(serviceKey()),
      google: Boolean(settings.external?.google),
      discord: Boolean(settings.external?.discord),
      ...(admin && { username: true }),
    };
  }

  /** Email + password, or (staging only) the admin username + password. */
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const p = jsonBody(body);
    const email = stringValue(p.email, 'email', 254).toLowerCase();
    const password = stringValue(p.password, 'password', 200);
    if (devLoginEnabled()) return this.devLogin(email, password);
    const admin = stagingAdmin();
    if (isStagingAdminLogin(admin, email)) return this.stagingAdminLogin(admin, password);
    return this.session(await this.gotrue('password', { email, password }));
  }

  /**
   * Customer sign-up. The account is created already confirmed through the Supabase admin API,
   * so no confirmation email is sent (Supabase's built-in mailer is heavily rate limited).
   */
  @Post('signup')
  @HttpCode(201)
  async signup(@Body() body: unknown, @Ip() ip: string) {
    const p = jsonBody(body);
    const email = stringValue(p.email, 'email', 254).toLowerCase();
    const password = stringValue(p.password, 'password', 200);
    const firstName = typeof p.firstName === 'string' ? p.firstName.trim().slice(0, 80) : '';
    const lastName = typeof p.lastName === 'string' ? p.lastName.trim().slice(0, 80) : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AppError('Enter a valid email address.');
    if (password.length < 8) throw new AppError('Use a password with at least 8 characters.');
    const sb = supabase();
    const key = serviceKey();
    if (devLoginEnabled() || !sb || !key)
      throw new AppError('Creating accounts is not available right now.', 503);
    // The staging admin's reserved address can't be claimed through sign-up.
    if (email === stagingAdmin()?.email)
      throw new AppError(
        'An account with this email already exists. Sign in instead.',
        409,
        'email_exists',
      );
    if (!allowSignup(ip || 'unknown'))
      throw new AppError('Too many sign-ups from this network. Try again later.', 429);

    const res = await fetch(`${sb.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          ...(firstName && { first_name: firstName }),
          ...(lastName && { last_name: lastName }),
        },
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      const message = String(data.msg ?? data.message ?? data.error_description ?? '');
      if (
        data.error_code === 'email_exists' ||
        (res.status === 422 && /already.*registered|exists/i.test(message))
      ) {
        throw new AppError(
          'An account with this email already exists. Sign in instead.',
          409,
          'email_exists',
        );
      }
      if (data.error_code === 'weak_password' || /password/i.test(message))
        throw new AppError(message || 'Choose a stronger password.');
      if (res.status === 429)
        throw new AppError('Too many attempts. Wait a few minutes and try again.', 429);
      throw new AppError('Could not create your account.', 502);
    }
    return this.session(await this.gotrue('password', { email, password }));
  }

  /**
   * Emails a password-reset link through Supabase Auth. The link opens the storefront's
   * /reset-password page signed in (redirectTo must be one of our sites, and must also be listed under
   * Authentication > URL Configuration > Redirect URLs in Supabase), where a new password is chosen.
   * Always answers OK for a well-formed address, so addresses can't be probed.
   */
  @RateLimit({ limit: 5, windowMs: 60 * 60_000 })
  @Post('reset')
  @HttpCode(200)
  async reset(@Body() body: unknown) {
    const p = jsonBody(body);
    const email = stringValue(p.email, 'email', 254).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AppError('Enter a valid email address.');
    let redirect = '';
    if (typeof p.redirectTo === 'string' && p.redirectTo) {
      const target = p.redirectTo.slice(0, 500);
      let origin: string;
      try {
        origin = new URL(target).origin;
      } catch {
        throw new AppError('Invalid redirectTo.');
      }
      if (!originAllowed(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
        throw new AppError('redirectTo is not an allowed site.');
      redirect = `?redirect_to=${encodeURIComponent(target)}`;
    }
    const sb = supabase();
    if (devLoginEnabled() || !sb)
      throw new AppError('Password reset is not available right now.', 503);
    const res = await fetch(`${sb.url}/auth/v1/recover${redirect}`, {
      method: 'POST',
      headers: { apikey: sb.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      if (res.status === 429)
        throw new AppError(
          'Too many reset emails were requested. Wait a few minutes and try again.',
          429,
        );
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      this.logger.warn(
        `Password reset email failed (${res.status}): ${String(data.msg ?? data.message ?? data.error_description ?? '')}`,
      );
      throw new AppError('The reset email could not be sent. Try again later.', 502);
    }
    return { success: true };
  }

  /** Sets a new password for the signed-in account. A reset link signs the person in first, then lands here. */
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('password')
  @Access('user')
  @HttpCode(200)
  async password(@Body() body: unknown, @Req() req: Request) {
    const password = stringValue(jsonBody(body).password, 'password', 200);
    if (password.length < 8) throw new AppError('Use a password with at least 8 characters.');
    const sb = supabase();
    if (devLoginEnabled() || !sb)
      throw new AppError('Changing passwords is not available right now.', 503);
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const res = await fetch(`${sb.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: sb.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      const message = String(data.msg ?? data.message ?? data.error_description ?? '');
      if (res.status === 401)
        throw new AppError(
          'Your reset link has expired. Request a new one.',
          401,
          'session_expired',
        );
      if (data.error_code === 'same_password')
        throw new AppError('Choose a password you have not used before.');
      if (data.error_code === 'weak_password' || /password/i.test(message))
        throw new AppError(message || 'Choose a stronger password.');
      throw new AppError('The password could not be changed.', 502);
    }
    return { success: true };
  }

  @RateLimit({ limit: 30, windowMs: 60_000 })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const refreshToken = stringValue(jsonBody(body).refreshToken, 'refreshToken', 2000);
    if (devLoginEnabled() && refreshToken.startsWith('dev:'))
      return this.devLogin(refreshToken.slice(4), env('AUTH_DEV_PASSWORD') ?? 'spinhobby');
    return this.session(await this.gotrue('refresh_token', { refresh_token: refreshToken }));
  }

  /** Where to send the browser for Google/Discord; Supabase redirects back with tokens in the URL hash. */
  @Get('oauth-url')
  oauthUrl(@Query('provider') provider: string, @Query('redirectTo') redirectTo: string) {
    if (!PROVIDERS.includes(provider as Provider)) throw new AppError('Unknown sign-in provider.');
    const target = validateRedirect(stringValue(redirectTo, 'redirectTo', 500));
    const sb = supabase();
    if (!sb) throw new AppError('Sign-in is not configured.', 503);
    const url = `${sb.url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(target)}`;
    return { success: true, url };
  }

  private async gotrue(grant: 'password' | 'refresh_token', payload: Record<string, string>) {
    const sb = supabase();
    if (!sb) throw new AppError('Sign-in is not configured.', 503);
    const res = await fetch(`${sb.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: sb.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      const message = String(data.msg ?? data.error_description ?? data.message ?? '');
      if (
        /invalid login credentials|invalid grant/i.test(message) ||
        data.error_code === 'invalid_credentials'
      )
        throw new AppError('Wrong email or password.', 401);
      if (/email not confirmed/i.test(message))
        throw new AppError(
          "This account isn't activated yet. Ask the store owner to confirm it.",
          403,
        );
      if (res.status === 429)
        throw new AppError('Too many attempts. Wait a few minutes and try again.', 429);
      if (grant === 'refresh_token')
        throw new AppError('Your session has expired. Sign in again.', 401);
      throw new AppError('Sign-in failed.', 502);
    }
    return data;
  }

  private async session(data: Record<string, any>) {
    const user = await this.auth.userFromAuthorization(`Bearer ${data.access_token}`);
    if (!user) throw new AppError('Your account profile could not be loaded.', 500);
    return {
      success: true,
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Number(
        data.expires_at ?? Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600),
      ),
      user,
    };
  }

  /**
   * Staging admin sign-in (see staging-admin.ts). The account lives in the staging Supabase
   * project: it is created on the first sign-in, kept an owner, and its password is re-synced
   * whenever STAGING_ADMIN_PASSWORD changes. The session it returns is an ordinary Supabase one.
   */
  private async stagingAdminLogin(admin: StagingAdmin, password: string) {
    if (!secretsMatch(password, admin.password))
      throw new AppError('Wrong email or password.', 401);
    const sb = supabase();
    const key = serviceKey();
    if (!sb || !key) throw new AppError('Sign-in is not configured.', 503);
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
    const failed = (what: string, status: number) => {
      this.logger.error(`Staging admin: ${what} failed (${status}).`);
      return new AppError(
        'The staging admin account could not be set up. Check SUPABASE_SERVICE_ROLE_KEY.',
        502,
      );
    };

    let profile = await this.db.one<{ id: string; role: string }>(
      'select id, role from public.profiles where email = $1',
      [admin.email],
    );
    if (!profile) {
      const res = await fetch(`${sb.url}/auth/v1/admin/users`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: admin.email,
          password: admin.password,
          email_confirm: true,
          user_metadata: { first_name: admin.username },
        }),
      });
      if (!res.ok) throw failed('creating the account', res.status);
      const created = (await res.json()) as { id: string };
      profile = { id: created.id, role: 'customer' };
      this.logger.log(`Staging admin: created ${admin.email} for username "${admin.username}".`);
    }
    if (profile.role !== 'owner')
      await this.db.exec("update public.profiles set role = 'owner' where id = $1", [profile.id]);

    const credentials = { email: admin.email, password: admin.password };
    try {
      return await this.session(await this.gotrue('password', credentials));
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
      // STAGING_ADMIN_PASSWORD changed after the account was created: bring Supabase in line and retry once.
      const res = await fetch(`${sb.url}/auth/v1/admin/users/${profile.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ password: admin.password }),
      });
      if (!res.ok) throw failed('updating the password', res.status);
      this.logger.log(
        `Staging admin: password for ${admin.email} updated from STAGING_ADMIN_PASSWORD.`,
      );
      return this.session(await this.gotrue('password', credentials));
    }
  }

  private async devLogin(email: string, password: string) {
    const expected = env('AUTH_DEV_PASSWORD') ?? 'spinhobby';
    const profile = await this.db.one<{ id: string }>(
      'select id from public.profiles where email = $1',
      [email],
    );
    if (
      !profile ||
      password !== expected ||
      !envList('AUTH_DEV_USERS')
        .map((e) => e.split(':')[0])
        .includes(email)
    ) {
      throw new AppError('Wrong email or password.', 401);
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const jwt = new SignJWT({ email, role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(profile.id)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(expiresAt);
    if (env('SUPABASE_URL')) jwt.setIssuer(`${env('SUPABASE_URL')!.replace(/\/$/, '')}/auth/v1`);
    const token = await jwt.sign(new TextEncoder().encode(env('SUPABASE_JWT_SECRET')!));
    return this.session({
      access_token: token,
      refresh_token: `dev:${email}`,
      expires_at: expiresAt,
    });
  }
}
