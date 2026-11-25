import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import { SupabaseAuthClient } from '../../integrations/supabase/supabase-auth.client.js';
import { SessionService, type Session } from './session.service.js';
import {
  STAGING_STAFF_EMAIL,
  secretsMatch,
  type QuickRole,
  type StagingAdmin,
} from './staging-admin.js';

/**
 * Staging admin sign-in (see staging-admin.ts). The account lives in the staging Supabase
 * project: it is created on the first sign-in, kept an owner, and its password is re-synced
 * whenever STAGING_ADMIN_PASSWORD changes. The session it returns is an ordinary Supabase one.
 */
@Injectable()
export class StagingAdminLogin {
  private readonly logger = new Logger(StagingAdminLogin.name);

  constructor(
    private readonly db: Db,
    private readonly supabase: SupabaseAuthClient,
    private readonly sessions: SessionService,
  ) {}

  async login(admin: StagingAdmin, password: string): Promise<Session> {
    if (!secretsMatch(password, admin.password))
      throw new AppError('Wrong email or password.', 401);
    return this.sessionFor(admin, admin.email, admin.username, 'owner');
  }

  /**
   * One-click sign-in from a remembered device (the caller has checked its device key): the owner account, or the reserved staff
   * account, which is made and kept the same way.
   */
  quick(admin: StagingAdmin, role: QuickRole): Promise<Session> {
    return role === 'owner'
      ? this.sessionFor(admin, admin.email, admin.username, 'owner')
      : this.sessionFor(admin, STAGING_STAFF_EMAIL, 'Staff', 'staff');
  }

  /** A session for one of the staging accounts: creates it on first use, keeps its role, and re-syncs its password. */
  private async sessionFor(
    admin: StagingAdmin,
    email: string,
    name: string,
    role: QuickRole,
  ): Promise<Session> {
    if (!this.supabase.config() || !this.supabase.serviceKey())
      throw new AppError('Sign-in is not configured.', 503);
    const failed = (what: string, status: number) => {
      this.logger.error(`Staging admin: ${what} failed (${status}).`);
      return new AppError(
        'The staging admin account could not be set up. Check SUPABASE_SERVICE_ROLE_KEY.',
        502,
      );
    };

    let profile = await this.db.one<{ id: string; role: string }>(
      'select id, role from public.profiles where email = $1',
      [email],
    );
    if (!profile) {
      const created = await this.supabase.adminCreateUser(email, admin.password, {
        first_name: name,
      });
      if (!created.ok) throw failed('creating the account', created.status);
      profile = { id: created.id, role: 'customer' };
      this.logger.log(`Staging admin: created ${email} (${role}).`);
    }
    if (profile.role !== role) {
      await this.db.exec('update public.profiles set role = $2 where id = $1', [profile.id, role]);
    }

    const credentials = { email, password: admin.password };
    try {
      return await this.sessions.fromTokens(await this.supabase.grant('password', credentials));
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
      // STAGING_ADMIN_PASSWORD changed after the account was created: bring Supabase in line and retry once.
      const updated = await this.supabase.adminSetPassword(profile.id, admin.password);
      if (!updated.ok) throw failed('updating the password', updated.status);
      this.logger.log(`Staging admin: password for ${email} updated from STAGING_ADMIN_PASSWORD.`);
      return this.sessions.fromTokens(await this.supabase.grant('password', credentials));
    }
  }
}
