import { env, envUrl } from './env.js';

/** The Supabase project URL, without a trailing slash. */
export const supabaseUrl = () => envUrl('SUPABASE_URL');

/** Key for calls made on behalf of a signed-in user (the newer "publishable" key, or the older "anon" key). */
export const supabasePublishableKey = () =>
  env('SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_ANON_KEY');

/** Key with full access (the "service role" key, or the newer "secret" key). Server-side only. */
export const supabaseServiceKey = () =>
  env('SUPABASE_SERVICE_ROLE_KEY') ?? env('SUPABASE_SECRET_KEY');

/** Key used to sign a user out everywhere: any key the project has, most restricted first. */
export const supabaseSignOutKey = () =>
  supabasePublishableKey() ?? env('SUPABASE_SERVICE_ROLE_KEY');

/** Secret that signs session tokens; used to check them locally. */
export const supabaseJwtSecret = () => env('SUPABASE_JWT_SECRET');
