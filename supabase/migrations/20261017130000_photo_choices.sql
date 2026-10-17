-- Which photos a product uses, chosen by a person. A Gleamshelf draft offers several: the photo computer's studio photo, the product cut out on one of
-- the shop's backgrounds, the photo as it was taken, that photo cropped to the product (no AI at all), and the maker's official photo. The original and
-- the crop are kept with the draft until it is handled.
alter table public.product_imports
  add column if not exists original_url text,
  add column if not exists cropped_url text;

-- Photos picked for a sales channel other than Square (eBay, not connected yet): kept in our storage, in order, ready for when it is.
create table if not exists public.channel_photos (
  id uuid primary key default gen_random_uuid(),
  square_item_id text not null,
  channel text not null check (channel in ('ebay')),
  image_url text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (square_item_id, channel, image_url)
);
create index if not exists channel_photos_item_idx on public.channel_photos (square_item_id, channel, position);
alter table public.channel_photos enable row level security;
revoke all on public.channel_photos from anon, authenticated;
create policy "Service role manages channel photos" on public.channel_photos for all to service_role using (true) with check (true);
