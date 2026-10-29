-- Discount codes shoppers type at checkout: a percentage or a fixed amount off the goods, optionally with a minimum order, dates
-- and a cap on how many paid orders may use it. `uses` counts paid orders only (an abandoned checkout doesn't use a code up).
create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0 and (kind <> 'percent' or value <= 100)),
  min_subtotal_cents integer not null default 0 check (min_subtotal_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.discount_codes enable row level security;
revoke all on public.discount_codes from anon, authenticated;

-- What a code took off an order. total_cents = subtotal_cents - discount_cents + shipping_cents + tax_cents.
alter table public.orders add column if not exists discount_code text;
alter table public.orders add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0);
