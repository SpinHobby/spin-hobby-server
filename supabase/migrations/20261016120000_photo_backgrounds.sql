-- Backgrounds for product photos. Gleamshelf sends each finished photo twice: on its white studio square, and as the product alone on a
-- transparent background (a cut-out PNG). The shop keeps its own backgrounds here (uploaded in the admin, in our image storage, never
-- Square's); a photo is the cut-out placed on the chosen background, made by us and then sent to Square like any other photo. Because the
-- cut-out is kept, a product's background can be changed later without the photo computer.

-- A background the shop uploaded. At most one is the default, picked first when a photo is used.
create table if not exists public.photo_backgrounds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  image_url text not null,
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists photo_backgrounds_one_default on public.photo_backgrounds (is_default) where is_default;

-- The cut-out behind a product photo in Square: which Square photo it made, and on which background (none: the white studio square).
create table if not exists public.product_cutouts (
  id uuid primary key default gen_random_uuid(),
  square_item_id text not null,
  image_id text not null unique,
  cutout_url text not null,
  background_id uuid references public.photo_backgrounds(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_cutouts_item_idx on public.product_cutouts (square_item_id);
create trigger product_cutouts_set_updated_at before update on public.product_cutouts
  for each row execute procedure public.set_updated_at();

-- The cut-out sent with a finished photo, until the photo is used (then it moves to product_cutouts) or turned down (then deleted).
alter table public.photo_jobs add column if not exists cutout_url text;
alter table public.product_imports add column if not exists cutout_url text;

alter table public.photo_backgrounds enable row level security;
alter table public.product_cutouts enable row level security;
revoke all on public.photo_backgrounds, public.product_cutouts from anon, authenticated;
create policy "Service role manages photo backgrounds" on public.photo_backgrounds for all to service_role using (true) with check (true);
create policy "Service role manages product cutouts" on public.product_cutouts for all to service_role using (true) with check (true);
