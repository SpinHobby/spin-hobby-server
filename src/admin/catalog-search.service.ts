import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { likePattern } from '../common/validation.js';
import { Db, type Row } from '../db/db.service.js';

/**
 * What an admin sees an item as. Unlike the storefront view this covers every catalog row:
 *  retired     deleted in Square (kept so old orders still resolve)
 *  hidden      hidden by staff, or not visible
 *  unavailable can't be bought: no sellable default variation
 *  otherwise   the storefront status: in, low, out, pre, closed
 */
export const ADMIN_STATES = ['in', 'low', 'out', 'pre', 'closed', 'unavailable', 'hidden', 'retired'] as const;
export type AdminState = (typeof ADMIN_STATES)[number];

export interface CatalogQuery {
  q?: string | null; status?: string | null; source?: string | null; categoryId?: string | null;
  featured?: string | null; alerts?: string | null; noPhoto?: string | null;
  min?: string | null; max?: string | null; sort?: string | null; dir?: string | null;
  limit?: string | null; cursor?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const flag = (v: string | null | undefined) => v === '1' || v === 'true';

/** Sort keys the admin table offers, mapped to a column expression of the `items` CTE. */
const SORTS: Record<string, string> = {
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
const ITEMS = `with recursive ${CATEGORY_PATHS},
items as (
  select
    p.square_item_id as id, p.default_variation_id as variation_id, p.name, p.description, p.source,
    p.is_active, p.is_visible, p.created_at, p.updated_at, p.synced_at, p.square_updated_at,
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

/** Admin catalog search: every item Square (or staff) put in the catalog, with search, filters, sorting and paging. */
@Injectable()
export class CatalogSearchService {
  constructor(private readonly db: Db) {}

  async search(query: CatalogQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(query.cursor ?? 0) || 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: (n: string) => string, value: unknown) => { params.push(value); where.push(clause(`$${params.length}`)); };

    // Every word must match somewhere: name, series, character, maker, JAN, category, SKU or a Square id.
    for (const term of (query.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      params.push(likePattern(term), term);
      const like = `$${params.length - 1}`, exact = `$${params.length}`;
      where.push(`(name ilike ${like} or series ilike ${like} or character ilike ${like} or manufacturer ilike ${like} or jan_code ilike ${like}
        or category ilike ${like} or id = ${exact} or variation_id = ${exact}
        or exists (select 1 from public.catalog_variations cv where cv.square_item_id = items.id
                    and (cv.sku ilike ${like} or cv.name ilike ${like} or cv.square_variation_id = ${exact})))`);
    }

    const states = (query.status ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of states) if (!(ADMIN_STATES as readonly string[]).includes(s)) throw new AppError(`Unknown status "${s}".`);
    if (states.length) add((n) => `state = any(${n}::text[])`, states);

    if (query.source) {
      if (query.source !== 'square' && query.source !== 'manual') throw new AppError('Source must be square or manual.');
      add((n) => `source = ${n}`, query.source);
    }
    if (query.categoryId) {
      if (query.categoryId === 'none') where.push('category_id is null');
      else if (UUID.test(query.categoryId)) add((n) => `category_id in (select id from cat_paths where ${n}::uuid = any(lineage))`, query.categoryId);
      else throw new AppError('Invalid category.');
    }
    if (flag(query.featured)) where.push('is_featured');
    if (flag(query.alerts)) where.push('alerts_waiting > 0');
    if (flag(query.noPhoto)) where.push('not has_photo');
    for (const [key, op] of [['min', '>='], ['max', '<=']] as const) {
      const raw = query[key];
      if (raw == null || raw === '') continue;
      const dollars = Number(raw);
      if (!Number.isFinite(dollars) || dollars < 0) throw new AppError(`Invalid ${key} price.`);
      add((n) => `price_cents ${op} ${n}`, Math.round(dollars * 100));
    }

    const sortKey = query.sort ?? 'created';
    if (!SORTS[sortKey]) throw new AppError(`Unknown sort "${sortKey}".`);
    // Text sorts read A→Z by default; dates, prices and counts read biggest/newest first.
    const dir = query.dir ?? (sortKey === 'name' || sortKey === 'category' ? 'asc' : 'desc');
    if (dir !== 'asc' && dir !== 'desc') throw new AppError('dir must be asc or desc.');
    const filter = where.length ? `where ${where.join(' and ')}` : '';

    const [rows, count] = await Promise.all([
      this.db.many(`${ITEMS} select * from items ${filter} order by ${SORTS[sortKey]} ${dir} nulls last, lower(name), id limit ${limit} offset ${offset}`, params),
      this.db.one<{ total: number }>(`${ITEMS} select count(*)::int as total from items ${filter}`, params),
    ]);
    const total = count?.total ?? 0;
    const next = offset + rows.length;
    return { items: await this.decorate(rows), total, ...(next < total ? { cursor: String(next) } : {}) };
  }

  /** Totals for the filter chips, over the whole catalog (not the current filters). */
  async counts() {
    const row = await this.db.one<Row>(
      `${ITEMS} select count(*)::int as total,
         ${ADMIN_STATES.map((s) => `count(*) filter (where state = '${s}')::int as "${s}"`).join(', ')},
         count(*) filter (where source = 'manual')::int as manual,
         count(*) filter (where source = 'square')::int as square,
         count(*) filter (where is_featured)::int as featured,
         count(*) filter (where alerts_waiting > 0)::int as alerts,
         count(*) filter (where not has_photo)::int as no_photo,
         max(synced_at) filter (where source = 'square') as last_synced_at
       from items`,
    );
    return {
      total: row?.total ?? 0,
      states: Object.fromEntries(ADMIN_STATES.map((s) => [s, Number(row?.[s] ?? 0)])),
      manual: row?.manual ?? 0, square: row?.square ?? 0, featured: row?.featured ?? 0, alerts: row?.alerts ?? 0, noPhoto: row?.no_photo ?? 0,
      lastSyncedAt: row?.last_synced_at ?? null,
    };
  }

  /** Adds the per-item lists (photos, variations) for just the rows on this page and maps to the API shape. */
  private async decorate(rows: Row[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [images, variations] = await Promise.all([
      this.db.many('select square_item_id, image_url from public.product_images where square_item_id = any($1::text[]) order by sort_order', [ids]),
      this.db.many(
        `select cv.square_item_id, cv.square_variation_id, cv.name, cv.sku, cv.price_cents, cv.is_sellable, i.quantity
           from public.catalog_variations cv left join public.inventory_snapshots i on i.square_variation_id = cv.square_variation_id
          where cv.square_item_id = any($1::text[]) order by cv.created_at, cv.square_variation_id`,
        [ids],
      ),
    ]);
    const photosByItem = new Map<string, string[]>();
    for (const r of images) photosByItem.set(r.square_item_id, [...(photosByItem.get(r.square_item_id) ?? []), r.image_url]);
    const variationsByItem = new Map<string, Row[]>();
    for (const v of variations) variationsByItem.set(v.square_item_id, [...(variationsByItem.get(v.square_item_id) ?? []), v]);

    return rows.map((r) => ({
      id: r.id,
      variationId: r.variation_id,
      name: r.name,
      description: r.description,
      series: r.series,
      character: r.character,
      manufacturer: r.manufacturer,
      category: r.category,
      categoryId: r.category_id ?? null,
      images: photosByItem.get(r.id) ?? [],
      priceCents: r.price_cents,
      compareAtCents: r.compare_at_cents,
      currency: 'CAD',
      status: r.status,
      state: r.state as AdminState,
      stockCount: r.stock_count,
      releaseMonth: r.release_month,
      orderByDate: r.order_by_date,
      rank: r.rank,
      maxPerCustomer: r.max_per_customer,
      createdAt: r.created_at,
      janCode: r.jan_code,
      availability: r.availability,
      isFeatured: r.is_featured,
      sortOrder: r.sort_order,
      source: r.source,
      alertsWaiting: r.alerts_waiting,
      // Admin-only: how Square (or staff) last touched it, and what can actually be bought.
      isActive: r.is_active,
      isVisible: r.is_visible,
      sellable: r.sellable,
      sku: r.sku,
      variationCount: r.variation_count,
      variations: (variationsByItem.get(r.id) ?? []).map((v) => ({
        id: v.square_variation_id, name: v.name, sku: v.sku, priceCents: v.price_cents, sellable: v.is_sellable, stockCount: v.quantity,
        isDefault: v.square_variation_id === r.variation_id,
      })),
      updatedAt: r.square_updated_at ?? r.updated_at,
      syncedAt: r.synced_at,
    }));
  }
}
