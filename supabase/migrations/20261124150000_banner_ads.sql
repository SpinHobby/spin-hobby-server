-- Home page banner ads: each hero slide becomes an ad the admin sets up (Admin > Homepage). An ad can carry a small label and a
-- button, switch itself on and off by date, and choose what shows behind it: product photos (the default), one uploaded photo, or
-- products the admin picks to promote a series.

alter table public.hero_slides
  add column label text check (label is null or char_length(label) <= 40),
  add column button_text text check (button_text is null or char_length(button_text) <= 40),
  add column starts_at timestamptz,
  add column ends_at timestamptz,
  add column backdrop text not null default 'products' check (backdrop in ('products', 'photo', 'chosen')),
  add column product_ids text[] not null default '{}' check (cardinality(product_ids) <= 12),
  add constraint hero_slides_dates_in_order check (ends_at is null or starts_at is null or ends_at > starts_at);

-- A slide that already has its own photo keeps showing it.
update public.hero_slides set backdrop = 'photo' where image_url is not null;
