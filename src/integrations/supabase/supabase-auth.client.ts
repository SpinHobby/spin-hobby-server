import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { env } from '../../config/env.js';

type Json = Record<string, any>;

/** The message Supabase attached to an error response, whichever field it used. */
const messageOf = (data: Json) => String(data.msg ?? data.message ?? data.error_description ?? '');

/**
 * The only code that makes HTTP calls to Supabase Auth (GoTrue). Everything the API needs from
 * Supabase sign-in goes through here, and Supabase's error responses are translated into the
 * AppErrors (and messages) shoppers and staff see.
 *
 * Two keys are involved: the publishable key acts as the signed-in person (log in, reset
 * password), the service-role key acts as the project admin (create users, set passwords).
 */
@Injectable()
export class SupabaseAuthClient {
  private readonly logger = new Logger(SupabaseAuthClient.name);

  /** Project URL and publishable key, or null when sign-in isn't configured. */
  config() {
    const url = env('SUPABASE_URL')?.replace(/\/$/, '');
    const key = env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY');
    return url && key ? { url, key } : null;
  }

  /** Admin key, for creating users and changing their passwords. */
  serviceKey() {
    return env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');
  }

  private requireConfig() {
    const sb = this.config();
    if (!sb) throw new AppError('Sign-in is not configured.', 503);
    return sb;
  }

  /** Which sign-in methods the Supabase project has switched on. Empty when it can't be reached. */
  async providerSettings(): Promise<{ external?: Record<string, boolean> }> {
    const sb = this.config();
    if (!sb) return { external: {} };
    const res = await fetch(`${sb.url}/auth/v1/settings`, { headers: { apikey: sb.key } }).catch(
      () => null,
    );
    return res?.ok ? ((await res.json()) as { external?: Record<string, boolean> }) : { external: {} };
  }

  /** Exchanges a password or refresh token for a session. Returns Supabase's raw token response. */
  async grant(grant: 'password' | 'refresh_token', payload: Record<string, string>): Promise<Json> {
    const sb = this.requireConfig();
    const res = await fetch(`${sb.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: sb.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as Json;
    if (!res.ok) {
      const message = String(data.msg ?? data.error_description ?? data.message ?? '');
      if (/invalid login credentials|invalid grant/i.test(message) || data.error_code === 'invalid_credentials')
        throw new AppError('Wrong email or password.', 401);
      if (/email not confirmed/i.test(message))
        throw new AppError("This account isn't activated yet. Ask the store owner to confirm it.", 403);
      if (res.status === 429)
        throw new AppError('Too many attempts. Wait a few minutes and try again.', 429);
      if (grant === 'refresh_token') throw new AppError('Your session has expired. Sign in again.', 401);
      throw new AppError('Sign-in failed.', 502);
    }
    return data;
  }

  /**
   * Creates a customer account that is already confirmed, so no confirmation email is sent
   * (Supabase's built-in mailer is heavily rate limited).
   */
  async createCustomer(input: { email: string; password: string; firstName: string; lastName: string }) {
    const sb = this.requireConfig();
    const key = this.serviceKey();
    if (!key) throw new AppError('Creating accounts is not available right now.', 503);
    const res = await fetch(`${sb.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: {
          ...(input.firstName && { first_name: input.firstName }),
          ...(input.lastName && { last_name: input.lastName }),
        },
      }),
    });
    if (res.ok) return;
    const data = (await res.json().catch(() => ({}))) as Json;
    const message = messageOf(data);
    if (data.error_code === 'email_exists' || (res.status === 422 && /already.*registered|exists/i.test(message))) {
      throw new AppError('An account with this email already exists. Sign in instead.', 409, 'email_exists');
    }
    if (data.error_code === 'weak_password' || /password/i.test(message))
      throw new AppError(message || 'Choose a stronger password.');
    if (res.status === 429) throw new AppError('Too many attempts. Wait a few minutes and try again.', 429);
    throw new AppError('Could not create your account.', 502);
  }

  /**
   * Emails a password-reset link. The link opens `redirectTo` signed in (it must also be listed under
   * Authentication > URL Configuration > Redirect URLs in Supabase).
   */
  async sendPasswordReset(email: string, redirectTo: string) {
    const sb = this.config();
    if (!sb) throw new AppError('Password reset is not available right now.', 503);
    const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    const res = await fetch(`${sb.url}/auth/v1/recover${query}`, {
      method: 'POST',
      headers: { apikey: sb.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) return;
    if (res.status === 429)
      throw new AppError('Too many reset emails were requested. Wait a few minutes and try again.', 429);
    const data = (await res.json().catch(() => ({}))) as Json;
    this.logger.warn(`Password reset email failed (${res.status}): ${messageOf(data)}`);
    throw new AppError('The reset email could not be sent. Try again later.', 502);
  }

  /** Sets a new password for the person whose access token this is. */
  async changeOwnPassword(accessToken: string, password: string) {
    const sb = this.config();
    if (!sb) throw new AppError('Changing passwords is not available right now.', 503);
    const res = await fetch(`${sb.url}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: sb.key, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) return;
    const data = (await res.json().catch(() => ({}))) as Json;
    const message = messageOf(data);
    if (res.status === 401)
      throw new AppError('Your reset link has expired. Request a new one.', 401, 'session_expired');
    if (data.error_code === 'same_password')
      throw new AppError('Choose a password you have not used before.');
    if (data.error_code === 'weak_password' || /password/i.test(message))
      throw new AppError(message || 'Choose a stronger password.');
    throw new AppError('The password could not be changed.', 502);
  }

  /** Revokes every session for this person. A token that is already invalid counts as signed out. */
  async signOutEverywhere(authorization: string) {
    const url = env('SUPABASE_URL')?.replace(/\/$/, '');
    const apiKey =
      env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY') ?? env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !apiKey)
      throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for sign-out.');
    const res = await fetch(`${url}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { Authorization: authorization, apikey: apiKey },
    });
    if (!res.ok && res.status !== 401) throw new Error(`Supabase sign-out failed (${res.status}).`);
  }

  /** Where to send the browser to sign in with Google/Discord. Supabase redirects back with tokens in the URL hash. */
  authorizeUrl(provider: string, redirectTo: string) {
    const sb = this.requireConfig();
    return `${sb.url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`;
  }

  /** Admin: create an already-confirmed user. Returns the new id, or the failing status. */
  async adminCreateUser(email: string, password: string, metadata: Record<string, unknown>) {
    const sb = this.requireConfig();
    const key = this.serviceKey()!;
    const res = await fetch(`${sb.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata }),
    });
    return res.ok ? { ok: true as const, id: ((await res.json()) as { id: string }).id } : { ok: false as const, status: res.status };
  }

  /** Admin: set a user's password. */
  async adminSetPassword(userId: string, password: string) {
    const sb = this.requireConfig();
    const key = this.serviceKey()!;
    const res = await fetch(`${sb.url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    return { ok: res.ok, status: res.status };
  }
}
