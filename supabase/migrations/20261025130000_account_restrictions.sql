-- Accounts the owner suspended (until a date) or banned (for good). Either one stops the account signing in or using the API
-- at once, even with a session it already has. Only the API sets these (owner only); the column grants keep users from it.
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists banned_at timestamptz;
alter table public.profiles add column if not exists restriction_reason text;
alter table public.profiles add column if not exists restricted_by uuid references public.profiles(id) on delete set null;
