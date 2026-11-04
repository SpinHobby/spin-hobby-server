-- Emails a shopper asked for, beyond their orders: a reminder of a cart they didn't finish, and news of new pre-orders from a
-- series or maker they follow. Both are opt-in (Canada's anti-spam law, CASL: express consent), and every email has a stop link.

-- "Email me my cart if I don't finish": one saved cart per email, ticked at checkout. One reminder, a few hours later, unless the
-- shopper paid in the meantime. `token` is the secret in the email's links (open the cart again, stop these emails).
create table if not exists public.cart_reminders (
  email text primary key check (email = lower(email)),
  lines jsonb not null default '[]'::jsonb,
  token uuid not null unique default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  reminded_at timestamptz
);
create index if not exists cart_reminders_due_idx on public.cart_reminders (updated_at) where reminded_at is null;

-- Emails that said "stop" to cart reminders. Kept even after the saved cart is gone, so ticking the box again later still asks first.
create table if not exists public.email_opt_outs (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- "Email me new pre-orders from Frieren / Good Smile Company": guests by email, signed-in customers linked too.
create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  kind text not null check (kind in ('series', 'maker')),
  name text not null check (length(name) between 1 and 120),
  user_id uuid references public.profiles(id) on delete set null,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create unique index if not exists follows_one_idx on public.follows (email, kind, lower(name));
create index if not exists follows_name_idx on public.follows (kind, lower(name));

-- Pre-orders already announced to followers (or there before following started), so each goes out once.
create table if not exists public.preorder_announcements (
  square_item_id text primary key,
  announced_at timestamptz not null default now()
);

alter table public.cart_reminders enable row level security;
alter table public.email_opt_outs enable row level security;
alter table public.follows enable row level security;
alter table public.preorder_announcements enable row level security;
revoke all on public.cart_reminders, public.email_opt_outs, public.follows, public.preorder_announcements from anon, authenticated;
