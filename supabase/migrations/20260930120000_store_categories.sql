-- Shop categories managed in the admin: a tree (categories -> subcategories -> ...),
-- independent of Square's category list. Products opt in via product_metadata.category_id.

create table public.store_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.store_categories(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);
-- No two siblings with the same name (case-insensitive).
create unique index store_categories_sibling_name_idx
  on public.store_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index store_categories_parent_idx on public.store_categories (parent_id, sort_order);
create trigger store_categories_set_updated_at before update on public.store_categories
  for each row execute procedure public.set_updated_at();

alter table public.store_categories enable row level security;
revoke all on public.store_categories from anon, authenticated;
create policy "Service role manages store categories" on public.store_categories
  for all to service_role using (true) with check (true);

alter table public.product_metadata
  add column if not exists category_id uuid references public.store_categories(id) on delete set null;
create index if not exists product_metadata_category_idx on public.product_metadata (category_id);

-- `category` now prefers the shop category name (falls back to Square's), and
-- `category_id` is appended so the storefront can filter by subtree.
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
  p.created_at,
  p.updated_at,
  p.source,
  m.category_id
from public.catalog_products p
join public.catalog_variations v
  on v.square_variation_id = p.default_variation_id and v.is_sellable
left join public.product_metadata m on m.square_item_id = p.square_item_id
left join public.store_categories sc on sc.id = m.category_id
left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
left join public.sales_stats stats on stats.square_item_id = p.square_item_id
cross join public.store_settings s
left join lateral (
  select array_agg(pi.image_url order by pi.sort_order) as images
  from public.product_images pi
  where pi.square_item_id = p.square_item_id
) images on true
where p.is_active and p.is_visible and coalesce(m.availability, 'auto') <> 'hidden';
