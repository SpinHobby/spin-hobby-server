-- Notes for the sample REST API (src/modules/hello): short pieces of text anyone can read through GET /hello/notes and
-- staff can add or delete. A learning example of a table, its seed rows (src/modules/sample/seed.ts) and the routes on top.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  text text not null check (length(btrim(text)) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Only the API (service role) reads and writes it; everyone else goes through the API's routes.
alter table public.notes enable row level security;
revoke all on public.notes from anon, authenticated;
create policy "Service role manages notes" on public.notes
  for all to service_role using (true) with check (true);
