import type {
  CatalogProductRow,
  CatalogVariationRow,
  InventorySnapshotRow,
  ProductMetadataRow,
} from '../../../database/rows.js';

// The building blocks of the admin catalog search: the states an item can be in, the sortable columns and the
// SQL that turns the catalog tables into one flat row per item. CatalogSearchService (next to this file) adds the
// filters, sorting and paging on top.

/**
 * What an admin sees an item as. Unlike the storefront view this covers every catalog row:
 *  retired     deleted in Square (kept so old orders still resolve)
 *  hidden      hidden by staff, or not visible
 *  unavailable can't be bought: no sellable default variation
 *  otherwise   the storefront status: in, low, out, pre, closed
 */
export const ADMIN_STATES = [
  'in',
  'low',
  'out',
  'pre',
  'closed',
  'unavailable',
  'hidden',
  'retired',
] as const;
export type AdminState = (typeof ADMIN_STATES)[number];

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const flag = (v: string | null | undefined) => v === '1' || v === 'true';

/** Sort keys the admin table offers, mapped to a column expression of the `items` CTE. */
export const SORTS: Record<string, string> = {
  name: 'lower(name)',
  price: 'price_cents',
  stock: 'stock_count',
  category: 'lower(category)',
  status: `array_position(array['in','low','out','pre','closed','unavailable','hidden','retired'], state)`,
  updated: 'coalesce(square_updated_at, updated_at)',
  created: 'created_at',
  release: 'order_by_date',
  alerts: 'alerts_waiting',
};

// Full "Parent › Child" path for every shop category, so a category filter can match a whole branch.
const CATEGORY_PATHS = `cat_paths as (
  select id, name::text as path, array[id] as lineage from public.store_categories where parent_id is null
  union all
  select c.id, cp.path || ' › ' || c.name, cp.lineage || c.id from public.store_categories c join cat_paths cp on c.parent_id = cp.id
)`;

// One row per catalog item (default variation's price and stock), whatever its visibility.
export const ITEMS = `with recursive ${CATEGORY_PATHS},
items as (
  select
    p.square_item_id as id, p.default_variation_id as variation_id, p.name, p.description, p.source,
    p.is_active, p.is_visible, p.replaced_by, coalesce(p.square_created_at, p.created_at) as created_at, p.updated_at, p.synced_at, p.square_updated_at,
    v.price_cents, v.sku, coalesce(v.is_sellable, false) as sellable,
    coalesce(m.availability, 'auto') as availability, m.series, m.character, m.manufacturer, m.jan_code,
    m.compare_at_cents, m.order_by_date, m.release_month, m.max_per_customer,
    coalesce(m.is_featured, false) as is_featured, coalesce(m.sort_order, 0) as sort_order, m.category_id,
    coalesce(sc.name, p.category) as category,
    i.quantity as stock_count,
    stats.rank,
    public.product_status(coalesce(m.availability, 'auto'), m.order_by_date, i.quantity, s.low_stock_threshold) as status,
    (select count(*)::int from public.catalog_variations cv where cv.square_item_id = p.square_item_id) as variation_count,
    (select count(*)::int from public.stock_alerts a join public.catalog_variations av on av.square_variation_id = a.square_variation_id
      where av.square_item_id = p.square_item_id and a.notified_at is null) as alerts_waiting,
    exists (select 1 from public.product_images pi where pi.square_item_id = p.square_item_id) as has_photo,
    case
      when not p.is_active then 'retired'
      when not p.is_visible or coalesce(m.availability, 'auto') = 'hidden' then 'hidden'
      when v.square_variation_id is null or not v.is_sellable then 'unavailable'
      else public.product_status(coalesce(m.availability, 'auto'), m.order_by_date, i.quantity, s.low_stock_threshold)
    end as state
  from public.catalog_products p
  left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
  left join public.product_metadata m on m.square_item_id = p.square_item_id
  left join public.store_categories sc on sc.id = m.category_id
  left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
  left join public.sales_stats stats on stats.square_item_id = p.square_item_id
  cross join public.store_settings s
)`;

/** One row of the `items` CTE above: a catalog item with its default variation's price and stock. */
export type ItemRow = Pick<
  CatalogProductRow,
  | 'name'
  | 'description'
  | 'source'
  | 'is_active'
  | 'is_visible'
  | 'replaced_by'
  | 'created_at'
  | 'updated_at'
  | 'synced_at'
  | 'square_updated_at'
> &
  Pick<
    ProductMetadataRow,
    | 'series'
    | 'character'
    | 'manufacturer'
    | 'jan_code'
    | 'compare_at_cents'
    | 'order_by_date'
    | 'release_month'
    | 'max_per_customer'
    | 'is_featured'
    | 'sort_order'
    | 'category_id'
  > &
  Pick<CatalogVariationRow, 'price_cents' | 'sku'> & {
    id: string;
    variation_id: string | null;
    sellable: boolean;
    availability: ProductMetadataRow['availability'];
    category: string | null;
    stock_count: InventorySnapshotRow['quantity'];
    rank: number | null;
    status: string;
    state: AdminState;
    variation_count: number;
    alerts_waiting: number;
    has_photo: boolean;
  };

/** A variation as listed under its item (`catalog_variations` plus its stock). */
export type VariationListRow = Pick<
  CatalogVariationRow,
  'square_item_id' | 'square_variation_id' | 'name' | 'sku' | 'price_cents' | 'is_sellable'
> & { quantity: InventorySnapshotRow['quantity'] };
