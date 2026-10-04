import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env, envList } from '../config/env.js';
import { Db } from '../db/db.service.js';

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

  constructor(private readonly db: Db) {}

  private async verify(token: string): Promise<JWTPayload | null> {
    const secret = env('SUPABASE_JWT_SECRET');
    const supabaseUrl = env('SUPABASE_URL')?.replace(/\/$/, '');
    const options = {
      audience: 'authenticated',
      ...(supabaseUrl ? { issuer: `${supabaseUrl}/auth/v1` } : {}),
    };
    try {
      if (secret)
        return (await jwtVerify(token, new TextEncoder().encode(secret), options)).payload;
      if (!supabaseUrl) {
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

  /** Revokes every session for this user via Supabase Auth. */
  async signOutEverywhere(authorization: string) {
    const supabaseUrl = env('SUPABASE_URL')?.replace(/\/$/, '');
    const apiKey =
      env('SUPABASE_PUBLISHABLE_KEY') ??
      env('SUPABASE_ANON_KEY') ??
      env('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !apiKey)
      throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required for sign-out.');
    const res = await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
      method: 'POST',
      headers: { Authorization: authorization, apikey: apiKey },
    });
    if (!res.ok && res.status !== 401) throw new Error(`Supabase sign-out failed (${res.status}).`);
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
    envList('OWNER_EMAILS')
      .map((e) => e.toLowerCase())
      .includes(address)
  )
    return 'owner';
  if (
    current === 'customer' &&
    envList('STAFF_EMAILS')
      .map((e) => e.toLowerCase())
      .includes(address)
  )
    return 'staff';
  return current;
}
