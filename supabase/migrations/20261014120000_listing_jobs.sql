-- New listings from photos. An admin uploads a set of photos of products that are not in the shop yet; each photo becomes a job. A Gleamshelf app on the shop's own
-- computer takes the jobs one at a time, cleans the photo, reads the box, looks the product up on the web and sends back a draft listing (title, description, category,
-- series) with the finished photo. The draft lands in the Imports inbox, where a person checks it and types the price and stock. Nothing becomes a product by itself.

create table if not exists public.listing_jobs (
  id uuid primary key default gen_random_uuid(),
  -- the photos uploaded together
  batch_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  file_name text not null default '' check (length(file_name) <= 200),
  -- what to do to the photo: the steps that are on (same options as improving a product's photos)
  options jsonb not null,
  -- the uploaded photo, in our image storage until the job is finished or cancelled
  source_url text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  -- a running job is given to one worker for a while; if the worker vanishes the job goes back in the queue
  lease_until timestamptz,
  worker_id uuid references public.import_tokens(id) on delete set null,
  -- the draft the worker made
  import_id uuid references public.product_imports(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  error text check (length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists listing_jobs_queue_idx on public.listing_jobs (status, created_at);
create index if not exists listing_jobs_batch_idx on public.listing_jobs (batch_id, created_at);
create trigger listing_jobs_set_updated_at before update on public.listing_jobs
  for each row execute procedure public.set_updated_at();

alter table public.listing_jobs enable row level security;
revoke all on public.listing_jobs from anon, authenticated;
create policy "Service role manages listing jobs" on public.listing_jobs for all to service_role using (true) with check (true);
