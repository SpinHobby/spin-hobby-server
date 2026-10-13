-- Draft listings sent by Gleamshelf (the photo studio app that cuts out, cleans and describes a product photo, all on the shop's
-- own computer). A draft is never a product: a staff member opens it in the admin, types the price and stock (Gleamshelf never
-- guesses those) and adds it through the normal "quick add", or rejects it. One draft per source photo, so running a folder twice
-- does not pile up copies.

-- A code an owner shows in the admin to connect a Gleamshelf app. Stored hashed; short-lived; dead after a few wrong tries.
create table if not exists public.import_pairings (
  code_hash text primary key,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- A connected Gleamshelf app. It can only send drafts and read the category and series lists; stored hashed, revocable.
create table if not exists public.import_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  label text not null default 'Gleamshelf' check (length(btrim(label)) between 1 and 80),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.product_imports (
  id uuid primary key default gen_random_uuid(),
  -- identifies the original photo (a hash of it), set by the sender
  source_key text not null unique check (length(source_key) between 8 and 128),
  status text not null default 'draft' check (status in ('draft', 'added', 'rejected')),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (length(description) <= 2500),
  category text check (length(category) <= 120),
  series text check (length(series) <= 120),
  -- what Gleamshelf says about how sure it is: flags worth a look, the pages the facts came from, the lookup outcome
  details jsonb not null default '{}'::jsonb,
  -- the finished photo, in our image storage until the product is added (then deleted and nulled)
  image_url text,
  token_id uuid references public.import_tokens(id) on delete set null,
  square_item_id text,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  reject_reason text check (length(reject_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_imports_status_idx on public.product_imports (status, created_at desc);
create trigger product_imports_set_updated_at before update on public.product_imports
  for each row execute procedure public.set_updated_at();

alter table public.import_pairings enable row level security;
alter table public.import_tokens enable row level security;
alter table public.product_imports enable row level security;
revoke all on public.import_pairings, public.import_tokens, public.product_imports from anon, authenticated;
create policy "Service role manages import pairings" on public.import_pairings for all to service_role using (true) with check (true);
create policy "Service role manages import tokens" on public.import_tokens for all to service_role using (true) with check (true);
create policy "Service role manages product imports" on public.product_imports for all to service_role using (true) with check (true);
