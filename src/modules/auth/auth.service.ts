import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { Db } from '../../database/db.service.js';
import { SupabaseAuthClient } from '../../integrations/supabase/supabase-auth.client.js';
import { ownerEmails, staffEmails } from '../../config/auth.config.js';
import { supabaseJwtSecret, supabaseUrl } from '../../config/supabase.config.js';
import { devLoginFlag } from '../../config/auth.config.js';

import { atLeast, higherRole, isRole, type AppRole } from './roles.js';

export type { AppRole } from './roles.js';

/** Why an account can't be used right now: suspended until a date, or banned for good. */
export type Restriction =
  | {
      kind: 'suspended';
      /** When it ends (midnight after the last day, Toronto time). */
      until: string;
      /** The last day it's in force (YYYY-MM-DD, Toronto time): what people are told. */
      lastDay: string;
      reason: string | null;
    }
  | { kind: 'banned'; since: string; reason: string | null };

export interface AppUser {
  id: string;
  email: string;
  role: AppRole;
  firstName: string | null;
  /** May open Audit (documents and sales records): every owner, and staff the owner has allowed. */
  canAudit: boolean;
  /** Set when the owner suspended or banned the account; the access guard and sign-in refuse it then. */
  restriction: Restriction | null;
}

/** The suspension or ban in force on a profile, if any (a suspension that has run out is none). */
export function restrictionOf(p: {
  suspended_until: string | Date | null;
  banned_at: string | Date | null;
  restriction_reason: string | null;
}): Restriction | null {
  const iso = (v: string | Date) => new Date(v).toISOString();
  if (p.banned_at) return { kind: 'banned', since: iso(p.banned_at), reason: p.restriction_reason };
  if (p.suspended_until && new Date(p.suspended_until).getTime() > Date.now())
    return {
      kind: 'suspended',
      until: iso(p.suspended_until),
      lastDay: torontoDay(new Date(new Date(p.suspended_until).getTime() - 1)),
      reason: p.restriction_reason,
    };
  return null;
}

const torontoDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(d);

/** What a suspended or banned person is told when they try to sign in or use the account. */
export function restrictionError(r: Restriction) {
  const why = r.reason ? ` Reason: ${r.reason}` : '';
  if (r.kind === 'banned')
    return new AppError(`This account has been closed by Spin Hobby.${why}`, 403, 'account_banned');
  const last = new Date(`${r.lastDay}T12:00:00Z`).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return new AppError(
    `This account is suspended until the end of ${last}.${why}`,
    403,
    'account_suspended',
  );
}

/**
 * Verifies Supabase Auth access tokens (the same tokens the storefront already sends)
 * and loads the matching profile. Supports the older shared JWT secret (HS256) or the
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
      this.jwks ??= createRemoteJWKSet(new URL(`${projectUrl}/auth/v1/.well-known/jwks.json`));
      return (await jwtVerify(token, this.jwks, options)).payload;
    } catch {
      return null; // expired, forged or for another project
    }
  }

  async userFromAuthorization(header: string | undefined): Promise<AppUser | null> {
    if (!header?.startsWith('Bearer ')) return null;
    const payload = await this.verify(header.slice('Bearer '.length));
    if (!payload?.sub) return null;
    const profile = await this.db.one<{
      id: string;
      email: string;
      role: AppRole;
      can_audit: boolean;
      suspended_until: string | null;
      banned_at: string | null;
      restriction_reason: string | null;
    }>(
      'select id, email, role, can_audit, suspended_until, banned_at, restriction_reason from public.profiles where id = $1',
      [payload.sub],
    );
    if (!profile) return null;
    const role = bootstrapRole(profile.email, profile.role);
    if (role !== profile.role) {
      await this.db.exec('update public.profiles set role = $2 where id = $1', [profile.id, role]);
      this.logger.log(`Promoted ${profile.email} to ${role} from OWNER_EMAILS/STAFF_EMAILS.`);
    }
    return {
      id: profile.id,
      email: profile.email,
      role,
      firstName: firstNameFrom(payload),
      canAudit: atLeast(role, 'owner') || (atLeast(role, 'staff') && profile.can_audit === true),
      restriction: restrictionOf(profile),
    };
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
  const listed = envRoleFor(email);
  if (!listed) return current;
  return isRole(current) ? higherRole(current, listed) : listed;
}

/** The role an address is given by OWNER_EMAILS / STAFF_EMAILS, if any (owner wins). */
export function envRoleFor(email: string): AppRole | null {
  const address = email.toLowerCase();
  const has = (list: string[]) => list.some((e) => e.toLowerCase() === address);
  if (has(ownerEmails())) return 'owner';
  if (has(staffEmails())) return 'staff';
  return null;
}
