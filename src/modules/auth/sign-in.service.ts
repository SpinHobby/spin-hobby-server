import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { RateLimiter } from '../../common/guards/rate-limit.guard.js';
import { SupabaseAuthClient } from '../../integrations/supabase/supabase-auth.client.js';
import { DevLogin } from './dev-login.service.js';
import type { SignupDto } from './dto/signup.dto.js';
import { SessionService, type Session } from './session.service.js';
import { StagingAdminLogin } from './staging-admin-login.service.js';
import { isStagingAdminLogin, stagingAdmin } from './staging-admin.js';

/** Sign-ups per IP address per hour; keeps bots from mass-creating accounts. */
const signupLimiter = new RateLimiter();
const allowSignup = (ip: string) => signupLimiter.hit(ip, 5, 60 * 60 * 1000).allowed;
/** Clears the sign-up counters (used by tests). */
export function resetSignupLimits() {
  signupLimiter.reset();
}

/**
 * How people sign in, sign up and manage their password. Supabase does the real work (see
 * SupabaseAuthClient); this class decides which path applies: a local dev login, the staging
 * admin login, or a normal Supabase account.
 */
@Injectable()
export class SignInService {
  constructor(
    private readonly supabase: SupabaseAuthClient,
    private readonly sessions: SessionService,
    private readonly devLogin: DevLogin,
    private readonly stagingAdminLogin: StagingAdminLogin,
  ) {}

  /** Which sign-in methods to show. `username: true` means the email field also accepts the staging admin username. */
  async providers() {
    if (this.devLogin.enabled())
      return {
        success: true,
        password: true,
        signup: false,
        google: false,
        discord: false,
        dev: true,
      };
    const admin = stagingAdmin();
    if (!this.supabase.config())
      return { success: true, password: false, signup: false, google: false, discord: false };
    const settings = await this.supabase.providerSettings();
    const password = Boolean(settings.external?.email);
    return {
      success: true,
      password: password || Boolean(admin),
      signup: password && Boolean(this.supabase.serviceKey()),
      google: Boolean(settings.external?.google),
      discord: Boolean(settings.external?.discord),
      ...(admin && { username: true }),
    };
  }

  /** Email + password, or (staging only) the admin username + password. */
  login(email: string, password: string): Promise<Session> {
    if (this.devLogin.enabled()) return this.devLogin.login(email, password);
    const admin = stagingAdmin();
    if (isStagingAdminLogin(admin, email)) return this.stagingAdminLogin.login(admin, password);
    return this.signInWithPassword(email, password);
  }

  /** Creates an already-confirmed customer account, then signs it in. */
  async signup(dto: SignupDto, ip: string): Promise<Session> {
    if (this.devLogin.enabled() || !this.supabase.config() || !this.supabase.serviceKey())
      throw new AppError('Creating accounts is not available right now.', 503);
    // The staging admin's reserved address can't be claimed through sign-up.
    if (dto.email === stagingAdmin()?.email)
      throw new AppError(
        'An account with this email already exists. Sign in instead.',
        409,
        'email_exists',
      );
    if (!allowSignup(ip || 'unknown'))
      throw new AppError('Too many sign-ups from this network. Try again later.', 429);
    await this.supabase.createCustomer(dto);
    return this.signInWithPassword(dto.email, dto.password);
  }

  /**
   * Emails a password-reset link. Always answers OK for a well-formed address, so addresses can't be probed.
   * `redirectTo` is already checked against our allowed sites (see ResetDto).
   */
  async requestPasswordReset(email: string, redirectTo: string) {
    if (this.devLogin.enabled())
      throw new AppError('Password reset is not available right now.', 503);
    await this.supabase.sendPasswordReset(email, redirectTo);
    return { success: true };
  }

  /** Sets a new password for the signed-in account. A reset link signs the person in first, then lands here. */
  async changePassword(accessToken: string, password: string) {
    if (this.devLogin.enabled())
      throw new AppError('Changing passwords is not available right now.', 503);
    await this.supabase.changeOwnPassword(accessToken, password);
    return { success: true };
  }

  refresh(refreshToken: string): Promise<Session> {
    if (this.devLogin.enabled() && refreshToken.startsWith('dev:'))
      return this.devLogin.login(refreshToken.slice('dev:'.length), this.devLogin.password());
    return this.refreshWithSupabase(refreshToken);
  }

  /** Where to send the browser to sign in with Google or Discord. */
  oauthUrl(provider: string, redirectTo: string) {
    return { success: true, url: this.supabase.authorizeUrl(provider, redirectTo) };
  }

  private async signInWithPassword(email: string, password: string) {
    return this.sessions.fromTokens(await this.supabase.grant('password', { email, password }));
  }

  private async refreshWithSupabase(refreshToken: string) {
    return this.sessions.fromTokens(
      await this.supabase.grant('refresh_token', { refresh_token: refreshToken }),
    );
  }
}
