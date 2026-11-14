-- Where each product photo sits in its square. Photos fill their card edge to edge (cropped, never shrunk onto a tile), so an admin can
-- move a photo (x, y: the point kept in view, 0-100 % across and down; 50/50 is the middle) and zoom in (1 = no zoom, up to 4).
-- Kept by product and photo address, apart from product_images, which the Square sync deletes and writes again on every change.
create table if not exists public.photo_frames (
  square_item_id text not null,
  image_url text not null check (length(image_url) between 1 and 1000),
  x real not null default 50 check (x between 0 and 100),
  y real not null default 50 check (y between 0 and 100),
  zoom real not null default 1 check (zoom between 1 and 4),
  updated_at timestamptz not null default now(),
  primary key (square_item_id, image_url)
);
alter table public.photo_frames enable row level security;
revoke all on public.photo_frames from anon, authenticated;
create policy "Service role manages photo frames" on public.photo_frames for all to service_role using (true) with check (true);
create trigger photo_frames_set_updated_at before update on public.photo_frames
  for each row execute procedure public.set_updated_at();

-- The shop's products carry their photos' frames: { "<photo address>": { "x": 50, "y": 30, "zoom": 1.2 } }. Added at the end: a view can
-- only gain columns there.
create or replace view public.storefront_products
with (security_invoker = true)
as
select
  p.square_item_id as id,
  v.square_variation_id as variation_id,
  p.name,
  coalesce(sc.name, p.category) as category,
  p.description,
  coalesce(m.series, null) as series,
  coalesce(m.character, null) as character,
  coalesce(m.jan_code, null) as jan_code,
  v.price_cents,
  v.currency,
  m.compare_at_cents,
  public.product_status(coalesce(m.availability, 'auto'), m.order_by_date, i.quantity, s.low_stock_threshold) as status,
  i.quantity as stock_count,
  m.release_month,
  m.order_by_date,
  stats.rank,
  m.max_per_customer,
  coalesce(m.is_featured, false) as is_featured,
  coalesce(m.sort_order, 0) as sort_order,
  coalesce(images.images, array[]::text[]) as images,
  coalesce(p.square_created_at, p.created_at) as created_at,
  p.updated_at,
  p.source,
  m.category_id,
  coalesce(images.cutout_images, array[]::text[]) as cutout_images,
  m.manufacturer,
  coalesce(frames.photo_frames, '{}'::jsonb) as photo_frames
from public.catalog_products p
join public.catalog_variations v
  on v.square_variation_id = p.default_variation_id and v.is_sellable
left join public.product_metadata m on m.square_item_id = p.square_item_id
left join public.store_categories sc on sc.id = m.category_id
left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
left join public.sales_stats stats on stats.square_item_id = p.square_item_id
cross join public.store_settings s
left join lateral (
  select array_agg(pi.image_url order by pi.sort_order) as images,
         array_agg(pi.image_url order by pi.sort_order) filter (where c.transparent) as cutout_images
  from public.product_images pi
  -- a Square photo is known by its Square id; a photo the shop keeps alone (a product added by hand) by its address
  left join public.product_cutouts c on c.image_id = coalesce(pi.square_image_id, pi.image_url)
  where pi.square_item_id = p.square_item_id
) images on true
left join lateral (
  select jsonb_object_agg(f.image_url, jsonb_build_object('x', f.x, 'y', f.y, 'zoom', f.zoom)) as photo_frames
  from public.photo_frames f
  where f.square_item_id = p.square_item_id
) frames on true
where p.is_active and p.is_visible and coalesce(m.availability, 'auto') <> 'hidden';
