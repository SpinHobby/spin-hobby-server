-- Rewards: one points balance per customer account, shared by every Spin Hobby app. The shop gives points for paid orders, and other
-- apps (Gleamshelf, the games) give or spend them through the rewards API with their own key, once the customer links that app to
-- their account with a short code. Points are spent in the shop as a one-time discount code.

-- How the shop gives and takes points. One row. Off until the owner switches it on (points are worth money).
create table if not exists public.reward_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- points for each whole dollar of goods paid (after any discount; not shipping or tax)
  points_per_dollar integer not null default 1 check (points_per_dollar between 0 and 100),
  -- what 100 points take off an order, in cents (100 = $1, so 1 point back per dollar is 1% back)
  cents_per_100_points integer not null default 100 check (cents_per_100_points between 1 and 10000),
  -- the fewest points a customer can turn into a code at once
  min_redeem_points integer not null default 500 check (min_redeem_points between 100 and 1000000),
  updated_at timestamptz not null default now()
);
insert into public.reward_settings (id) values (true) on conflict do nothing;

-- Each account's current balance, kept beside the ledger so a spend can be checked and taken in one statement.
create table if not exists public.reward_balances (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  points integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Every change to a balance, never edited: + earned, - spent or taken back. `app` is 'shop', 'admin' or a connected app's slug.
-- `ref` is the giver's own id for the event (an order, a level cleared...), so sending the same award twice only counts once.
create table if not exists public.reward_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  app text not null check (app ~ '^[a-z0-9-]{2,32}$'),
  points integer not null check (points <> 0),
  reason text not null check (length(reason) between 1 and 200),
  ref text check (ref is null or length(ref) between 1 and 200),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists reward_entries_app_ref_idx on public.reward_entries (app, ref) where ref is not null;
create index if not exists reward_entries_user_idx on public.reward_entries (user_id, created_at desc);
create index if not exists reward_entries_created_idx on public.reward_entries (created_at desc);

-- The other apps allowed to give and spend points. Each has a secret key (only its hash is kept) and a daily cap per customer.
create table if not exists public.reward_apps (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,32}$' and slug not in ('shop', 'admin')),
  name text not null check (length(name) between 1 and 80),
  key_hash text not null unique,
  daily_cap integer not null default 500 check (daily_cap between 1 and 1000000),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- A customer's link to one app. The app only ever sees `id` (its member id), never the account's email or id.
create table if not exists public.reward_links (
  id uuid primary key default gen_random_uuid(),
  app text not null references public.reward_apps(slug) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unlinked_at timestamptz
);
create unique index if not exists reward_links_open_idx on public.reward_links (app, user_id) where unlinked_at is null;

-- Short codes a customer types into an app to link it (hash only; 15 minutes; used once).
create table if not exists public.reward_link_codes (
  code_hash text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);

-- Discount codes made from points belong to the account that made them.
alter table public.discount_codes add column if not exists reward_user_id uuid references public.profiles(id) on delete set null;
alter table public.discount_codes add column if not exists reward_points integer check (reward_points is null or reward_points > 0);

do $$
declare t text;
begin
  foreach t in array array['reward_settings', 'reward_balances', 'reward_entries', 'reward_apps', 'reward_links', 'reward_link_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists "Service role manages %s" on public.%I', t, t);
    execute format('create policy "Service role manages %s" on public.%I for all to service_role using (true) with check (true)', t, t);
  end loop;
end $$;
