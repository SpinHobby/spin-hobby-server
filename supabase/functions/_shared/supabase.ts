import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.95.3';

export type AppRole = 'customer' | 'staff' | 'owner';

export interface AppUser {
  id: string;
  email: string;
  role: AppRole;
}

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (!url || !key) throw new Error('The Supabase service key is not configured.');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function currentUser(req: Request, db: SupabaseClient): Promise<AppUser | null> {
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user?.id || !data.user.email) return null;

  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, email, role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError || !profile) return null;
  return { id: profile.id, email: profile.email, role: profile.role as AppRole };
}

export async function requireUser(req: Request, db: SupabaseClient): Promise<AppUser> {
  const user = await currentUser(req, db);
  if (!user) throw new Error('Sign in is required.');
  return user;
}

export async function requireAdmin(req: Request, db: SupabaseClient, ownerOnly = false): Promise<AppUser> {
  const user = await requireUser(req, db);
  const allowed = ownerOnly ? user.role === 'owner' : user.role === 'owner' || user.role === 'staff';
  if (!allowed) throw new Error('You do not have permission to perform this action.');
  return user;
}

export async function writeAdminLog(
  db: SupabaseClient,
  adminId: string,
  action: string,
  target: string,
  data: Record<string, unknown> = {},
) {
  const { error } = await db.from('admin_logs').insert({
    admin_id: adminId,
    action,
    target,
    data,
  });
  if (error) throw error;
}
