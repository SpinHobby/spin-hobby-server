-- Shop searches that found nothing, one row per search (folded: lower case, no accents), so the shop can see what shoppers
-- look for and don't find (Admin > Dashboard), then stock it or add a synonym. Only the words are kept: no shopper, no IP.
create table if not exists public.search_misses (
  query text primary key check (length(query) between 1 and 80),
  times integer not null default 1 check (times > 0),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index if not exists search_misses_recent_idx on public.search_misses (last_at desc);

alter table public.search_misses enable row level security;
