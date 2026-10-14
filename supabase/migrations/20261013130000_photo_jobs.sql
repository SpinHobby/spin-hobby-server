-- Bulk photo improvement. An admin picks products in the admin and asks for their photos to be improved (background removed, put on white, stickers taken
-- off, sharper); each photo becomes a job in a queue. A Gleamshelf app on the shop's own computer (a gaming PC left on overnight) takes jobs from the queue,
-- does the work and sends the improved photo back. Nothing changes on a product until a person has looked at the result and approved it; approving puts the
-- new photo in the old one's place and hides (never deletes) the original, the same as editing a photo by hand.

alter table public.import_tokens add column if not exists features text[] not null default '{}';

create table if not exists public.photo_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  -- what to do to every photo: the steps that are on
  options jsonb not null,
  scope text not null default 'main' check (scope in ('main', 'all')),
  created_at timestamptz not null default now()
);

create table if not exists public.photo_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.photo_batches(id) on delete cascade,
  square_item_id text not null,
  product_name text not null default '',
  -- the Square photo to improve, and where to read it from
  image_id text not null,
  source_url text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'applied', 'rejected', 'cancelled')),
  attempts int not null default 0,
  -- a running job is given to one worker for a while; if the worker vanishes the job goes back in the queue
  lease_until timestamptz,
  worker_id uuid references public.import_tokens(id) on delete set null,
  -- the improved photo, in our image storage until it is applied or rejected
  result_url text,
  -- what the worker says about it: flags worth a look, notes, how long it took
  details jsonb not null default '{}'::jsonb,
  error text check (length(error) <= 500),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one photo is in the queue (or waiting for a decision) once
create unique index if not exists photo_jobs_open_idx on public.photo_jobs (image_id) where status in ('queued', 'running', 'done');
create index if not exists photo_jobs_queue_idx on public.photo_jobs (status, created_at);
create index if not exists photo_jobs_batch_idx on public.photo_jobs (batch_id, created_at);
create trigger photo_jobs_set_updated_at before update on public.photo_jobs
  for each row execute procedure public.set_updated_at();

alter table public.photo_batches enable row level security;
alter table public.photo_jobs enable row level security;
revoke all on public.photo_batches, public.photo_jobs from anon, authenticated;
create policy "Service role manages photo batches" on public.photo_batches for all to service_role using (true) with check (true);
create policy "Service role manages photo jobs" on public.photo_jobs for all to service_role using (true) with check (true);
