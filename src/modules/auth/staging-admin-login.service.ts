import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import { SupabaseAuthClient } from '../../integrations/supabase/supabase-auth.client.js';
import { SessionService, type Session } from './session.service.js';
import { secretsMatch, type StagingAdmin } from './staging-admin.js';

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
      [admin.email],
    );
    if (!profile) {
      const created = await this.supabase.adminCreateUser(admin.email, admin.password, {
        first_name: admin.username,
      });
      if (!created.ok) throw failed('creating the account', created.status);
      profile = { id: created.id, role: 'customer' };
      this.logger.log(`Staging admin: created ${admin.email} for username "${admin.username}".`);
    }
    if (profile.role !== 'owner') {
      await this.db.exec("update public.profiles set role = 'owner' where id = $1", [profile.id]);
    }

    const credentials = { email: admin.email, password: admin.password };
    try {
      return await this.sessions.fromTokens(await this.supabase.grant('password', credentials));
    } catch (error) {
      if (!(error instanceof AppError && error.status === 401)) throw error;
      // STAGING_ADMIN_PASSWORD changed after the account was created: bring Supabase in line and retry once.
      const updated = await this.supabase.adminSetPassword(profile.id, admin.password);
      if (!updated.ok) throw failed('updating the password', updated.status);
      this.logger.log(
        `Staging admin: password for ${admin.email} updated from STAGING_ADMIN_PASSWORD.`,
      );
      return this.sessions.fromTokens(await this.supabase.grant('password', credentials));
    }
  }
}
