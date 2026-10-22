-- Descriptions for products the shop already has. An admin picks products (or "every product without a description"); each becomes a job. A Gleamshelf app on
-- the shop's own computer takes the jobs one at a time, reads the product's photo, looks the product up on the web and sends back a proposed description, series,
-- maker and category. A person reads each proposal and applies it (the description goes to Square) or skips it. Nothing changes on the shop by itself.

create table if not exists public.describe_jobs (
  id uuid primary key default gen_random_uuid(),
  -- the products sent together
  batch_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  square_item_id text not null references public.catalog_products(square_item_id) on delete cascade,
  -- what the product was called and the photo used, as they were when the job was made
  product_name text not null default '' check (length(product_name) <= 300),
  photo_url text,
  -- queued -> running -> done (waiting for a person) -> applied | dismissed; failed after three tries; cancelled before it started
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled', 'applied', 'dismissed')),
  attempts int not null default 0,
  lease_until timestamptz,
  worker_id uuid references public.import_tokens(id) on delete set null,
  progress int,
  step text,
  started_at timestamptz,
  -- the proposal: description, series, manufacturer, category, highlights, unsupported, flags, sources, lookup
  result jsonb not null default '{}'::jsonb,
  error text check (length(error) <= 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- a product is in the queue (or waiting for review) once
create unique index if not exists describe_jobs_open_idx on public.describe_jobs (square_item_id) where status in ('queued', 'running', 'done');
create index if not exists describe_jobs_queue_idx on public.describe_jobs (status, created_at);
create trigger describe_jobs_set_updated_at before update on public.describe_jobs
  for each row execute procedure public.set_updated_at();

alter table public.describe_jobs enable row level security;
revoke all on public.describe_jobs from anon, authenticated;
create policy "Service role manages describe jobs" on public.describe_jobs for all to service_role using (true) with check (true);
