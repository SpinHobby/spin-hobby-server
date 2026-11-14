-- The collector's glossary: short explanations of words shoppers meet on product pages ("Nendoroid", "prize figure",
-- "scale figure"...). Staff add terms in the admin; the shop lists them A to Z.
create table if not exists public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null check (length(btrim(term)) between 1 and 80),
  meaning text not null check (length(btrim(meaning)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One entry per term, ignoring case and spacing ("Nendoroid" and " nendoroid" are the same term).
create unique index if not exists glossary_terms_term_idx on public.glossary_terms (lower(btrim(term)));
create trigger glossary_terms_set_updated_at before update on public.glossary_terms
  for each row execute procedure public.set_updated_at();

-- Only the API (service role) reads and writes it; shoppers go through GET /glossary.
alter table public.glossary_terms enable row level security;
revoke all on public.glossary_terms from anon, authenticated;
create policy "Service role manages glossary terms" on public.glossary_terms
  for all to service_role using (true) with check (true);
