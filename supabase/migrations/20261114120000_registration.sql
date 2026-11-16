-- Registration: a confirmed email, a phone number, and whether the customer has seen the welcome step.
alter table public.profiles add column if not exists email_verified_at timestamptz;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists welcomed_at timestamptz;

-- Accounts made before this change count as confirmed and welcomed: they are real shoppers, and asking them now would only get in
-- the way of their next order.
update public.profiles
   set email_verified_at = coalesce(email_verified_at, created_at),
       welcomed_at = coalesce(welcomed_at, created_at);

-- The 6-digit code that confirms an email (one live code per account; only its hash is kept).
create table if not exists public.email_codes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  sent_at timestamptz not null default now()
);

alter table public.email_codes enable row level security;
drop policy if exists "Service role manages email_codes" on public.email_codes;
create policy "Service role manages email_codes" on public.email_codes for all to service_role using (true) with check (true);
