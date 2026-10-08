-- The storefront's "new" ordering and the homepage's New arrivals read `created_at`. For items that come from Square
-- that used to be the day we first synced them (the same day for everything the first sync brought in), so "new"
-- meant nothing. It is now the day the item was really added: Square's own date when known, ours otherwise.
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
