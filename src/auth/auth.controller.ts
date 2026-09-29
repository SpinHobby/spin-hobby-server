import { Body, Controller, Get, HttpCode, Ip, Post, Query } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AppError } from '../common/errors.js';
import { jsonBody, stringValue } from '../common/validation.js';
import { allowedOrigins, env, envList } from '../config/env.js';
import { Db } from '../db/db.service.js';
import { AuthService } from './auth.service.js';

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
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const signupAttempts = new Map<string, number[]>();
export function resetSignupLimits() { signupAttempts.clear(); }
function allowSignup(ip: string) {
  const now = Date.now();
  const recent = (signupAttempts.get(ip) ?? []).filter((t) => now - t < SIGNUP_WINDOW_MS);
  if (recent.length >= SIGNUP_LIMIT) { signupAttempts.set(ip, recent); return false; }
  recent.push(now);
  signupAttempts.set(ip, recent);
  if (signupAttempts.size > 10_000) signupAttempts.clear();
  return true;
}

/** Local development only: sign in as a seeded account without Supabase (see scripts/dev-local.mjs). */
function devLoginEnabled() {
  return env('NODE_ENV') !== 'production' && env('AUTH_DEV_LOGIN') === 'true' && Boolean(env('SUPABASE_JWT_SECRET'));
}

/**
 * Sign-in for the storefront and admin. The browser only talks to this API; this API talks to
 * Supabase Auth, so no Supabase keys or SDK are needed in the frontend.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly db: Db) {}

  /** Which sign-in methods to show. */
  @Get('providers')
  async providers() {
    if (devLoginEnabled()) return { success: true, password: true, signup: false, google: false, discord: false, dev: true };
    const sb = supabase();
    if (!sb) return { success: true, password: false, signup: false, google: false, discord: false };
    const res = await fetch(`${sb.url}/auth/v1/settings`, { headers: { apikey: sb.key } }).catch(() => null);
    const settings = res?.ok ? ((await res.json()) as { external?: Record<string, boolean> }) : { external: {} };
    const password = Boolean(settings.external?.email);
    return { success: true, password, signup: password && Boolean(serviceKey()), google: Boolean(settings.external?.google), discord: Boolean(settings.external?.discord) };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const p = jsonBody(body);
    const email = stringValue(p.email, 'email', 254).toLowerCase();
    const password = stringValue(p.password, 'password', 200);
    if (devLoginEnabled()) return this.devLogin(email, password);
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Enter a valid email address.');
    if (password.length < 8) throw new AppError('Use a password with at least 8 characters.');
    const sb = supabase();
    const key = serviceKey();
    if (devLoginEnabled() || !sb || !key) throw new AppError('Creating accounts is not available right now.', 503);
    if (!allowSignup(ip || 'unknown')) throw new AppError('Too many sign-ups from this network. Try again later.', 429);

    const res = await fetch(`${sb.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password, email_confirm: true,
        user_metadata: { ...(firstName && { first_name: firstName }), ...(lastName && { last_name: lastName }) },
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      const message = String(data.msg ?? data.message ?? data.error_description ?? '');
      if (data.error_code === 'email_exists' || (res.status === 422 && /already.*registered|exists/i.test(message))) {
        throw new AppError('An account with this email already exists. Sign in instead.', 409, 'email_exists');
      }
      if (data.error_code === 'weak_password' || /password/i.test(message)) throw new AppError(message || 'Choose a stronger password.');
      if (res.status === 429) throw new AppError('Too many attempts. Wait a few minutes and try again.', 429);
      throw new AppError('Could not create your account.', 502);
    }
    return this.session(await this.gotrue('password', { email, password }));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const refreshToken = stringValue(jsonBody(body).refreshToken, 'refreshToken', 2000);
    if (devLoginEnabled() && refreshToken.startsWith('dev:')) return this.devLogin(refreshToken.slice(4), env('AUTH_DEV_PASSWORD') ?? 'spinhobby');
    return this.session(await this.gotrue('refresh_token', { refresh_token: refreshToken }));
  }

  /** Where to send the browser for Google/Discord; Supabase redirects back with tokens in the URL hash. */
  @Get('oauth-url')
  oauthUrl(@Query('provider') provider: string, @Query('redirectTo') redirectTo: string) {
    if (!PROVIDERS.includes(provider as Provider)) throw new AppError('Unknown sign-in provider.');
    const target = stringValue(redirectTo, 'redirectTo', 500);
    let origin: string;
    try { origin = new URL(target).origin; } catch { throw new AppError('Invalid redirectTo.'); }
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (!allowedOrigins().includes(origin) && !local) throw new AppError('redirectTo is not an allowed site.');
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
      if (/invalid login credentials|invalid grant/i.test(message) || data.error_code === 'invalid_credentials') throw new AppError('Wrong email or password.', 401);
      if (/email not confirmed/i.test(message)) throw new AppError("This account isn't activated yet. Ask the store owner to confirm it.", 403);
      if (res.status === 429) throw new AppError('Too many attempts. Wait a few minutes and try again.', 429);
      if (grant === 'refresh_token') throw new AppError('Your session has expired. Sign in again.', 401);
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
      expiresAt: Number(data.expires_at ?? Math.floor(Date.now() / 1000) + Number(data.expires_in ?? 3600)),
      user,
    };
  }

  private async devLogin(email: string, password: string) {
    const expected = env('AUTH_DEV_PASSWORD') ?? 'spinhobby';
    const profile = await this.db.one<{ id: string }>('select id from public.profiles where email = $1', [email]);
    if (!profile || password !== expected || !envList('AUTH_DEV_USERS').map((e) => e.split(':')[0]).includes(email)) {
      throw new AppError('Wrong email or password.', 401);
    }
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const jwt = new SignJWT({ email, role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(profile.id)
      .setAudience('authenticated').setIssuedAt().setExpirationTime(expiresAt);
    if (env('SUPABASE_URL')) jwt.setIssuer(`${env('SUPABASE_URL')!.replace(/\/$/, '')}/auth/v1`);
    const token = await jwt.sign(new TextEncoder().encode(env('SUPABASE_JWT_SECRET')!));
    return this.session({ access_token: token, refresh_token: `dev:${email}`, expires_at: expiresAt });
  }
}
