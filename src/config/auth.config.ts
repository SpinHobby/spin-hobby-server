import { env, envList } from './env.js';
import { isProduction, isStaging } from './app.config.js';

/** Emails that become owners / staff the first time they sign in. */
export const ownerEmails = () => envList('OWNER_EMAILS');
export const staffEmails = () => envList('STAFF_EMAILS');

/**
 * Local development only (`npm run dev:local`): sign in without Supabase using a shared dev password.
 * Never on in production, whatever AUTH_DEV_LOGIN says.
 */
export const devLoginFlag = () => !isProduction() && env('AUTH_DEV_LOGIN') === 'true';
export const devLoginPassword = () => env('AUTH_DEV_PASSWORD') ?? 'spinhobby';
/** Emails allowed to use the dev login; empty means any email. */
export const devLoginUsers = () => envList('AUTH_DEV_USERS');

/** Staging only: a shared admin username and password for testers who don't have a Supabase account. */
export const stagingAdminLoginEnabled = () => isStaging();
export const stagingAdminUsername = () => env('STAGING_ADMIN_USERNAME')?.trim();
export const stagingAdminPassword = () => env('STAGING_ADMIN_PASSWORD');
