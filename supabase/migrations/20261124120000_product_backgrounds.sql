-- A background of its own for a product. Until now every transparent product photo showed on the one shop background. A product can now show on
-- plain white, on any background of the library, or on its own box art (the artwork of its box, softened, kept in our image storage), and the
-- shop has a rule for products that have no choice of their own: the shop background, or box art when the product has one. Nothing is re-made
-- when a choice changes: the website draws the transparent photo on whichever background the product has now, so an admin can change one
-- product, or all of them at once, at any time.

-- A product's own choice. No row: the shop's rule decides.
create table if not exists public.product_backgrounds (
  square_item_id text primary key,
  mode text not null check (mode in ('shop', 'white', 'library', 'box_art')),
  -- for `library`: which background (deleted from the library: the shop's rule decides again)
  background_id uuid references public.photo_backgrounds(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((mode = 'library') = (background_id is not null))
);

-- A product's box art: made in the admin's browser from one of the product's photos (or uploaded), stored by us. One per product.
create table if not exists public.product_box_art (
  square_item_id text primary key,
  image_url text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The rule for products with no choice of their own: `shop` (the shop background) or `box_art` (its box art when it has one, else the shop background).
alter table public.store_settings
  add column if not exists product_background_rule text not null default 'shop' check (product_background_rule in ('shop', 'box_art'));

alter table public.product_backgrounds enable row level security;
alter table public.product_box_art enable row level security;
revoke all on public.product_backgrounds, public.product_box_art from anon, authenticated;
create policy "Service role manages product backgrounds" on public.product_backgrounds for all to service_role using (true) with check (true);
create policy "Service role manages product box art" on public.product_box_art for all to service_role using (true) with check (true);
