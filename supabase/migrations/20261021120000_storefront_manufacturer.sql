-- `manufacturer`: the maker (Good Smile Company, Bandai Spirits...). Google Shopping and product search results ask for a brand on most
-- products; the website's build puts it in the Google Shopping feed and each product page's structured data. Added at the end:
-- a view can only gain columns there.
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
  m.manufacturer
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
where p.is_active and p.is_visible and coalesce(m.availability, 'auto') <> 'hidden';
