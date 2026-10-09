-- Photos an admin has hidden from a product. Square has no per-photo "hidden" switch: a photo is shown when it is
-- in the item's photo list and hidden when it is taken out of that list. A hidden photo stays in Square's catalog
-- and can be put back; this table only remembers which pictures belong to which product (no picture is stored here).
create table if not exists public.hidden_photos (
  image_id text primary key,
  square_item_id text not null references public.catalog_products(square_item_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists hidden_photos_item_idx on public.hidden_photos (square_item_id);
alter table public.hidden_photos enable row level security;
revoke all on public.hidden_photos from anon, authenticated;
create policy "Service role manages hidden photos" on public.hidden_photos
  for all to service_role using (true) with check (true);
