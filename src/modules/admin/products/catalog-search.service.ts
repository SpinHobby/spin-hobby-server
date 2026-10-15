import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { likePattern } from '../../../common/validation/rules.js';
import { Db } from '../../../database/db.service.js';
import { FRONT_PAGE_SLOTS } from '../../catalog/front-page.js';
import { photoLocation } from '../../catalog/photo-location.js';
import type { ProductImageRow } from '../../../database/rows.js';
import {
  ADMIN_STATES,
  flag,
  ITEMS,
  SORTS,
  UUID,
  type ItemRow,
  type VariationListRow,
} from './catalog-search.sql.js';
import type { CatalogSearchQuery } from './dto/catalog-search.query.dto.js';

/** The most products "select all" picks at once. */
export const MAX_IDS = 500;

/** Admin catalog search: every item Square (or staff) put in the catalog, with search, filters, sorting and paging. */
@Injectable()
export class CatalogSearchService {
  constructor(private readonly db: Db) {}

  async search(query: CatalogSearchQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(query.cursor ?? 0) || 0, 0);
    const { filter, params, order } = this.filters(query);

    const [rows, count] = await Promise.all([
      this.db.many<ItemRow>(
        `${ITEMS} select * from items ${filter} order by ${order} limit ${limit} offset ${offset}`,
        params,
      ),
      this.db.one<{ total: number }>(
        `${ITEMS} select count(*)::int as total from items ${filter}`,
        params,
      ),
    ]);
    const total = count?.total ?? 0;
    const next = offset + rows.length;
    return {
      items: await this.decorate(rows),
      total,
      frontPageSlots: FRONT_PAGE_SLOTS,
      ...(next < total ? { cursor: String(next) } : {}),
    };
  }

  /** The ids of every product matching the filters (up to `MAX_IDS`), in list order: "select all" across pages. */
  async ids(query: CatalogSearchQuery) {
    const { filter, params, order } = this.filters(query);
    const rows = await this.db.many<{ id: string }>(
      `${ITEMS} select id from items ${filter} order by ${order} limit ${MAX_IDS + 1}`,
      params,
    );
    return {
      ids: rows.slice(0, MAX_IDS).map((r) => r.id),
      truncated: rows.length > MAX_IDS,
    };
  }

  /** The WHERE clause, its parameters and the ORDER BY for the search, filters and sort in `query`. */
  private filters(query: CatalogSearchQuery) {
    // A product that was moved into Square keeps its old row (past orders, a safe retry) but is not listed twice.
    const where: string[] = ['replaced_by is null'];
    const params: unknown[] = [];
    const add = (clause: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(clause(`$${params.length}`));
    };

    // Every word must match somewhere: name, series, character, maker, JAN, category, SKU or a Square id.
    for (const term of (query.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      params.push(likePattern(term), term);
      const like = `$${params.length - 1}`,
        exact = `$${params.length}`;
      where.push(`(name ilike ${like} or series ilike ${like} or character ilike ${like} or manufacturer ilike ${like} or jan_code ilike ${like}
        or category ilike ${like} or id = ${exact} or variation_id = ${exact}
        or exists (select 1 from public.catalog_variations cv where cv.square_item_id = items.id
                    and (cv.sku ilike ${like} or cv.name ilike ${like} or cv.square_variation_id = ${exact})))`);
    }

    const states = (query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of states)
      if (!(ADMIN_STATES as readonly string[]).includes(s))
        throw new AppError(`Unknown status "${s}".`);
    if (states.length) add((n) => `state = any(${n}::text[])`, states);

    if (query.source) {
      if (query.source !== 'square' && query.source !== 'manual')
        throw new AppError('Source must be square or manual.');
      add((n) => `source = ${n}`, query.source);
    }
    if (query.categoryId) {
      if (query.categoryId === 'none') where.push('category_id is null');
      else if (UUID.test(query.categoryId))
        add(
          (n) => `category_id in (select id from cat_paths where ${n}::uuid = any(lineage))`,
          query.categoryId,
        );
      else throw new AppError('Invalid category.');
    }
    if (query.seriesId) {
      if (query.seriesId === 'none') where.push('series_id is null');
      else if (UUID.test(query.seriesId)) add((n) => `series_id = ${n}::uuid`, query.seriesId);
      else throw new AppError('Invalid series.');
    }
    if (flag(query.featured)) where.push('is_featured');
    if (flag(query.alerts)) where.push('alerts_waiting > 0');
    if (flag(query.noPhoto)) where.push('not has_photo');
    // Added, or changed (in Square, or here for a hand-entered product), in the last N hours.
    if (query.changedWithin != null && query.changedWithin !== '') {
      const hours = Number(query.changedWithin);
      if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 90)
        throw new AppError('changedWithin must be a number of hours (1 to 2160).');
      add(
        (n) =>
          `greatest(created_at, coalesce(square_updated_at, updated_at)) >= now() - make_interval(hours => ${n}::int)`,
        hours,
      );
    }
    for (const [key, op] of [
      ['min', '>='],
      ['max', '<='],
    ] as const) {
      const raw = query[key];
      if (raw == null || raw === '') continue;
      const dollars = Number(raw);
      if (!Number.isFinite(dollars) || dollars < 0) throw new AppError(`Invalid ${key} price.`);
      add((n) => `price_cents ${op} ${n}`, Math.round(dollars * 100));
    }

    const sortKey = query.sort ?? 'created';
    if (!SORTS[sortKey]) throw new AppError(`Unknown sort "${sortKey}".`);
    // Text sorts read A→Z by default; dates, prices and counts read biggest/newest first.
    const dir =
      query.dir ??
      (sortKey === 'name' || sortKey === 'category' || sortKey === 'front' ? 'asc' : 'desc');
    if (dir !== 'asc' && dir !== 'desc') throw new AppError('dir must be asc or desc.');
    const filter = where.length ? `where ${where.join(' and ')}` : '';
    return { filter, params, order: `${SORTS[sortKey]} ${dir} nulls last, lower(name), id` };
  }

  /** Totals for the filter chips, over the whole catalog (not the current filters). */
  async counts() {
    const row = await this.db.one<Record<string, number | string | null>>(
      `${ITEMS} select count(*)::int as total,
         ${ADMIN_STATES.map((s) => `count(*) filter (where state = '${s}')::int as "${s}"`).join(', ')},
         count(*) filter (where source = 'manual')::int as manual,
         count(*) filter (where source = 'square')::int as square,
         count(*) filter (where is_featured)::int as featured,
         count(*) filter (where alerts_waiting > 0)::int as alerts,
         count(*) filter (where not has_photo)::int as no_photo,
         max(synced_at) filter (where source = 'square') as last_synced_at
       from items where replaced_by is null`,
    );
    return {
      total: row?.total ?? 0,
      states: Object.fromEntries(ADMIN_STATES.map((s) => [s, Number(row?.[s] ?? 0)])),
      manual: row?.manual ?? 0,
      square: row?.square ?? 0,
      featured: row?.featured ?? 0,
      alerts: row?.alerts ?? 0,
      noPhoto: row?.no_photo ?? 0,
      lastSyncedAt: row?.last_synced_at ?? null,
    };
  }

  /** Adds the per-item lists (photos, variations) for just the rows on this page and maps to the API shape. */
  private async decorate(rows: ItemRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [images, variations] = await Promise.all([
      this.db.many<Pick<ProductImageRow, 'square_item_id' | 'image_url'>>(
        'select square_item_id, image_url from public.product_images where square_item_id = any($1::text[]) order by sort_order',
        [ids],
      ),
      this.db.many<VariationListRow>(
        `select cv.square_item_id, cv.square_variation_id, cv.name, cv.sku, cv.price_cents, cv.is_sellable, i.quantity
           from public.catalog_variations cv left join public.inventory_snapshots i on i.square_variation_id = cv.square_variation_id
          where cv.square_item_id = any($1::text[]) order by cv.created_at, cv.square_variation_id`,
        [ids],
      ),
    ]);
    const photosByItem = new Map<string, string[]>();
    for (const r of images)
      photosByItem.set(r.square_item_id, [
        ...(photosByItem.get(r.square_item_id) ?? []),
        r.image_url,
      ]);
    const variationsByItem = new Map<string, VariationListRow[]>();
    for (const v of variations)
      variationsByItem.set(v.square_item_id, [
        ...(variationsByItem.get(v.square_item_id) ?? []),
        v,
      ]);

    return rows.map((r) => ({
      id: r.id,
      variationId: r.variation_id,
      name: r.name,
      description: r.description,
      series: r.series,
      seriesId: r.series_id,
      character: r.character,
      manufacturer: r.manufacturer,
      category: r.category,
      categoryId: r.category_id ?? null,
      images: photosByItem.get(r.id) ?? [],
      // Where the first photo is kept: Square, our own storage, somewhere else, or nowhere.
      photoSource: photoLocation(photosByItem.get(r.id)?.[0]),
      // Set on a hand-entered product that was moved into Square: the id of its Square replacement.
      replacedBy: r.replaced_by,
      priceCents: r.price_cents,
      compareAtCents: r.compare_at_cents,
      currency: 'CAD',
      status: r.status,
      state: r.state,
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
      frontPage: r.front_rank,
      source: r.source,
      alertsWaiting: r.alerts_waiting,
      // Admin-only: how Square (or staff) last touched it, and what can actually be bought.
      isActive: r.is_active,
      isVisible: r.is_visible,
      sellable: r.sellable,
      sku: r.sku,
      variationCount: r.variation_count,
      // Default variation first, then the rest in the order they were created (a stable sort keeps that order).
      variations: (variationsByItem.get(r.id) ?? [])
        .map((v) => ({
          id: v.square_variation_id,
          name: v.name,
          sku: v.sku,
          priceCents: v.price_cents,
          sellable: v.is_sellable,
          stockCount: v.quantity,
          isDefault: v.square_variation_id === r.variation_id,
        }))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
      updatedAt: r.square_updated_at ?? r.updated_at,
      syncedAt: r.synced_at,
    }));
  }
}
