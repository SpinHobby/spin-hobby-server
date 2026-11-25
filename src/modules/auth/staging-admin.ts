import { createHmac, timingSafeEqual } from 'node:crypto';
import { supabaseUrl } from '../../config/supabase.config.js';
import {
  stagingAdminLoginEnabled,
  stagingAdminPassword,
  stagingAdminUsername,
} from '../../config/auth.config.js';

/** The production Supabase project; the staging admin login must never exist there. */
export const PRODUCTION_SUPABASE_REF = 'zmlltsytckexrmybvnof';

/** Reserved address for the staging admin account (no email is ever sent to it). */
export const STAGING_ADMIN_DOMAIN = 'staging.spinhobby.com';

export interface StagingAdmin {
  username: string;
  password: string;
  email: string;
}

/**
 * Staging only: a fixed owner login (STAGING_ADMIN_USERNAME / STAGING_ADMIN_PASSWORD, see
 * render.staging.yaml) so anyone testing the staging site can open /admin without creating an
 * account. It is backed by a real user in the staging Supabase project, created on first sign-in,
 * so sessions, refresh and sign-out work exactly like any other account.
 *
 * Off unless APP_ENV=staging, and always off against the production Supabase project.
 */
export function stagingAdmin(): StagingAdmin | null {
  if (!stagingAdminLoginEnabled()) return null;
  const username = stagingAdminUsername();
  const password = stagingAdminPassword();
  if (!username || !password) return null;
  if (supabaseUrl()?.includes(PRODUCTION_SUPABASE_REF)) return null;
  const local = username.toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'admin';
  return { username, password, email: `${local}@${STAGING_ADMIN_DOMAIN}` };
}

/** True when the sign-in form's email field holds the staging admin username (case-insensitive). */
export function isStagingAdminLogin(
  admin: StagingAdmin | null,
  identifier: string,
): admin is StagingAdmin {
  return Boolean(admin) && identifier.trim().toLowerCase() === admin!.username.toLowerCase();
}

/** Constant-time comparison so response timing never leaks how much of the password matched. */
export function secretsMatch(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- Quick sign-in on a remembered device ----------
 * Staging is public, so there is no open "sign in as owner" button: anyone with the address could use it. Instead, a browser that has
 * signed in once with the staging admin password is given a device key, and from then on signs in with one click (as the owner, or as
 * a staff account kept for trying the staff view). The key is signed with the staging admin password, so changing
 * STAGING_ADMIN_PASSWORD forgets every device, and it stops working by itself after DEVICE_KEY_DAYS. */

/** The reserved staff account for quick sign-in (no email is ever sent to it). */
export const STAGING_STAFF_EMAIL = `quick-staff@${STAGING_ADMIN_DOMAIN}`;
export const DEVICE_KEY_DAYS = 90;
export type QuickRole = 'owner' | 'staff';

const sign = (admin: StagingAdmin, expiresAt: number) =>
  createHmac('sha256', `staging-device:${admin.password}`).update(String(expiresAt)).digest('hex');

/** A device key for a browser that just signed in as the staging admin: "<expiry in ms>.<signature>". */
export function deviceKey(admin: StagingAdmin, now = Date.now()) {
  const expiresAt = now + DEVICE_KEY_DAYS * 86_400_000;
  return {
    key: `${expiresAt}.${sign(admin, expiresAt)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

/** True for a key this server signed that has not run out. */
export function deviceKeyValid(admin: StagingAdmin, key: string, now = Date.now()) {
  const [expiry, signature, ...rest] = key.split('.');
  const expiresAt = Number(expiry);
  if (rest.length || !signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now)
    return false;
  return secretsMatch(signature, sign(admin, expiresAt));
}
