-- Adds a site-wide maintenance-mode toggle to the existing store_settings
-- singleton. The existing "Edge Functions manage store settings" RLS policy
-- already covers these new columns table-wide - no policy changes needed.

alter table public.store_settings
  add column maintenance_mode boolean not null default false,
  add column maintenance_message text;
