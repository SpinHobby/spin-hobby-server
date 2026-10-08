-- The day a product was really added in Square. Our own created_at is when we first synced it (the same day for
-- everything the first sync brought in), so the admin list's "Added" date uses this one when it is known.
alter table public.catalog_products add column if not exists square_created_at timestamptz;
