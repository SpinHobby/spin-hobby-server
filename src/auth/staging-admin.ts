import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/** The production Supabase project; the staging admin login must never exist there. */
export const PRODUCTION_SUPABASE_REF = 'zmlltsytckexrmybvnof';

/** Reserved address for the staging admin account (no email is ever sent to it). */
export const STAGING_ADMIN_DOMAIN = 'staging.spinhobby.com';

export interface StagingAdmin { username: string; password: string; email: string }

/**
 * Staging only: a fixed owner login (STAGING_ADMIN_USERNAME / STAGING_ADMIN_PASSWORD, see
 * render.staging.yaml) so anyone testing the staging site can open /admin without creating an
 * account. It is backed by a real user in the staging Supabase project, created on first sign-in,
 * so sessions, refresh and sign-out work exactly like any other account.
 *
 * Off unless APP_ENV=staging, and always off against the production Supabase project.
 */
export function stagingAdmin(): StagingAdmin | null {
  if (env('APP_ENV') !== 'staging') return null;
  const username = env('STAGING_ADMIN_USERNAME')?.trim();
  const password = env('STAGING_ADMIN_PASSWORD');
  if (!username || !password) return null;
  if (env('SUPABASE_URL')?.includes(PRODUCTION_SUPABASE_REF)) return null;
  const local = username.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'admin';
  return { username, password, email: `${local}@${STAGING_ADMIN_DOMAIN}` };
}

/** True when the sign-in form's email field holds the staging admin username (case-insensitive). */
export function isStagingAdminLogin(admin: StagingAdmin | null, identifier: string): admin is StagingAdmin {
  return Boolean(admin) && identifier.trim().toLowerCase() === admin!.username.toLowerCase();
}

/** Constant-time comparison so response timing never leaks how much of the password matched. */
export function secretsMatch(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
