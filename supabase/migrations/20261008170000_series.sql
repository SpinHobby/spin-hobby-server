-- The list of anime / franchises a product can belong to, so the admin picks from a dropdown instead of typing
-- free text (and "Re:Zero", "Re Zero" and "ReZero" stop being three different series). A product's series is
-- optional: `series_id` stays null for products that have none. `product_metadata.series` keeps the name as text
-- (the storefront view and searches read it), and is kept equal to the series name by the app.
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  aliases text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists series_name_idx on public.series (lower(btrim(name)));
create trigger series_set_updated_at before update on public.series
  for each row execute procedure public.set_updated_at();

alter table public.series enable row level security;
revoke all on public.series from anon, authenticated;
create policy "Service role manages series" on public.series
  for all to service_role using (true) with check (true);

alter table public.product_metadata
  add column if not exists series_id uuid references public.series(id) on delete set null;
create index if not exists product_metadata_series_idx on public.product_metadata (series_id) where series_id is not null;

-- Turn what is already typed into the list: one row per name (ignoring case and spacing), spelled the way most
-- products spell it, then link the products to it.
insert into public.series (name)
select name from (
  select distinct on (lower(btrim(series))) btrim(series) as name
    from (select series, count(*) as uses from public.product_metadata
           where series is not null and btrim(series) <> '' group by series) counted
   order by lower(btrim(series)), uses desc
) names;
update public.product_metadata m set series_id = s.id, series = s.name
  from public.series s where lower(btrim(m.series)) = lower(btrim(s.name));
