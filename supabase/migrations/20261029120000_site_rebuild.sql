-- The website's pages for search engines (sitemap, Google Shopping feed, a page per product) are written when it is built.
-- The API asks Netlify to rebuild when what shoppers can see has changed; this row remembers what the last build was asked
-- for, so a restart doesn't ask again. One row only.
create table if not exists public.site_rebuild (
  id boolean primary key default true check (id),
  fingerprint text,
  requested_at timestamptz
);
alter table public.site_rebuild enable row level security;
revoke all on public.site_rebuild from anon, authenticated;
