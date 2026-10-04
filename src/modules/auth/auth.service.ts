import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { Db } from '../../database/db.service.js';
import { SupabaseAuthClient } from '../../integrations/supabase/supabase-auth.client.js';
import { ownerEmails, staffEmails } from '../../config/auth.config.js';
import { supabaseJwtSecret, supabaseUrl } from '../../config/supabase.config.js';
import { devLoginFlag } from '../../config/auth.config.js';

export type AppRole = 'customer' | 'staff' | 'owner';
export interface AppUser {
  id: string;
  email: string;
  role: AppRole;
  firstName: string | null;
}

/**
 * Verifies Supabase Auth access tokens (the same tokens the storefront already sends)
 * and loads the matching profile. Supports the legacy shared JWT secret (HS256) or the
 * project's published signing keys (JWKS).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly db: Db,
    private readonly supabase: SupabaseAuthClient,
  ) {}

  private async verify(token: string): Promise<JWTPayload | null> {
    const secret = supabaseJwtSecret();
    const projectUrl = supabaseUrl();
    const options = {
      audience: 'authenticated',
      ...(projectUrl ? { issuer: `${projectUrl}/auth/v1` } : {}),
    };
    try {
      if (secret)
        return (await jwtVerify(token, new TextEncoder().encode(secret), options)).payload;
      if (!projectUrl) {
        this.logger.error('Set SUPABASE_URL (JWKS) or SUPABASE_JWT_SECRET to verify sign-ins.');
        return null;
      }
      this.jwks ??= createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
      return (await jwtVerify(token, this.jwks, options)).payload;
    } catch {
      return null; // expired, forged or for another project
    }
  }

  async userFromAuthorization(header: string | undefined): Promise<AppUser | null> {
    if (!header?.startsWith('Bearer ')) return null;
    const payload = await this.verify(header.slice('Bearer '.length));
    if (!payload?.sub) return null;
    const profile = await this.db.one<{ id: string; email: string; role: AppRole }>(
      'select id, email, role from public.profiles where id = $1',
      [payload.sub],
    );
    if (!profile) return null;
    const role = bootstrapRole(profile.email, profile.role);
    if (role !== profile.role) {
      await this.db.exec('update public.profiles set role = $2 where id = $1', [profile.id, role]);
      this.logger.log(`Promoted ${profile.email} to ${role} from OWNER_EMAILS/STAFF_EMAILS.`);
    }
    return { id: profile.id, email: profile.email, role, firstName: firstNameFrom(payload) };
  }

  /**
   * Signs the person out everywhere. Local dev sign-in has no Supabase session to revoke, so there the
   * browser just drops its token.
   */
  async signOut(authorization: string) {
    if (devLoginFlag()) return;
    await this.supabase.signOutEverywhere(authorization);
  }
}

/** First name for greetings: set at sign-up, or given by Google/Discord (Supabase copies it into the token). */
export function firstNameFrom(payload: JWTPayload): string | null {
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const pick = [meta.first_name, meta.given_name, meta.full_name, meta.name].find(
    (v) => typeof v === 'string' && v.trim(),
  );
  return typeof pick === 'string' ? pick.trim().split(/\s+/)[0].slice(0, 80) : null;
}

/** Env-listed emails get at least that role. Never demotes a role set by hand. */
export function bootstrapRole(email: string, current: AppRole): AppRole {
  const address = email.toLowerCase();
  if (
    ownerEmails()
      .map((e) => e.toLowerCase())
      .includes(address)
  )
    return 'owner';
  if (
    current === 'customer' &&
    staffEmails()
      .map((e) => e.toLowerCase())
      .includes(address)
  )
    return 'staff';
  return current;
}
