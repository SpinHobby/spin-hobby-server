import { Injectable } from '@nestjs/common';
import { likePattern } from '../common/validation.js';
import { Db, type Row } from '../db/db.service.js';
import { publicProduct, type PublicProduct } from './product.mapper.js';

export interface ProductQuery {
  limit?: string | null; cursor?: string | null; category?: string | null; status?: string | null;
  sort?: string | null; min?: string | null; max?: string | null; q?: string | null;
}

const SORTS: Record<string, string> = {
  new: 'created_at desc, id',
  release: 'release_month asc nulls last, id',
  price_asc: 'price_cents asc, id',
  price_desc: 'price_cents desc, id',
  pop: 'rank asc nulls last, id',
};

@Injectable()
export class CatalogService {
  constructor(private readonly db: Db) {}

  async productPage(query: ProductQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? 24) || 24, 1), 60);
    const offset = Math.max(Number(query.cursor ?? 0) || 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: (n: string) => string, value: unknown) => { params.push(value); where.push(clause(`$${params.length}`)); };

    const category = query.category?.trim().slice(0, 120);
    if (category) add((n) => `category = ${n}`, category);
    const statuses = (query.status ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
    if (statuses.length) add((n) => `status = any(${n}::text[])`, statuses);
    const min = Number(query.min);
    const max = Number(query.max);
    if (query.min != null && query.min !== '' && Number.isFinite(min) && min >= 0) add((n) => `price_cents >= ${n}`, Math.round(min * 100));
    if (query.max != null && query.max !== '' && Number.isFinite(max) && max >= 0) add((n) => `price_cents <= ${n}`, Math.round(max * 100));
    const q = query.q?.trim();
    if (q) add((n) => `(name ilike ${n} or series ilike ${n} or character ilike ${n} or jan_code ilike ${n})`, likePattern(q));

    const filter = where.length ? `where ${where.join(' and ')}` : '';
    const order = SORTS[query.sort ?? 'new'] ?? SORTS.new;
    const [rows, count] = await Promise.all([
      this.db.many(`select * from public.storefront_products ${filter} order by ${order} limit ${limit} offset ${offset}`, params),
      this.db.one<{ total: number }>(`select count(*)::int as total from public.storefront_products ${filter}`, params),
    ]);
    const total = count?.total ?? 0;
    const next = offset + rows.length;
    return { success: true as const, items: rows.map(publicProduct) as PublicProduct[], total, ...(next < total ? { cursor: String(next) } : {}) };
  }

  async facets() {
    const rows = await this.db.many<{ category: string | null; status: string; price_cents: number }>(
      'select category, status, price_cents from public.storefront_products',
    );
    const categories = new Map<string, number>();
    const status = { in: 0, pre: 0, out: 0 };
    const buckets = [
      { label: 'Under $25', min: 0, max: 25 as number | null, count: 0 },
      { label: '$25–75', min: 25, max: 75 as number | null, count: 0 },
      { label: '$75–150', min: 75, max: 150 as number | null, count: 0 },
      { label: '$150+', min: 150, max: null as number | null, count: 0 },
    ];
    for (const row of rows) {
      if (row.category) categories.set(row.category, (categories.get(row.category) ?? 0) + 1);
      if (row.status === 'in' || row.status === 'low') status.in += 1;
      else if (row.status === 'pre') status.pre += 1;
      else if (row.status === 'out' || row.status === 'closed') status.out += 1;
      const price = Number(row.price_cents) / 100;
      const bucket = buckets.find((b) => price >= b.min && (b.max === null || price < b.max));
      if (bucket) bucket.count += 1;
    }
    return {
      success: true as const,
      categories: [...categories].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
      status,
      price: buckets,
    };
  }

  /** Visible shop categories as a flat list (parentId links build the tree). */
  async categories() {
    const rows = await this.db.many<{ id: string; parent_id: string | null; name: string; sort_order: number }>(
      'select id, parent_id, name, sort_order from public.store_categories where is_visible order by sort_order, name',
    );
    // A hidden category hides its whole branch from navigation.
    const visible = new Set(rows.map((r) => r.id));
    const ok = (r: { parent_id: string | null }): boolean => r.parent_id === null || (visible.has(r.parent_id) && ok(rows.find((x) => x.id === r.parent_id)!));
    return rows.filter(ok).map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name, sortOrder: r.sort_order }));
  }

  async homepage() {
    const [slides, featured, preorders, ranking, newInStock, events, categories] = await Promise.all([
      this.db.many('select * from public.hero_slides where is_visible order by sort_order, created_at'),
      this.db.many('select * from public.storefront_products where is_featured order by sort_order, id limit 8'),
      this.db.many("select * from public.storefront_products where status = 'pre' order by order_by_date asc nulls last, id limit 12"),
      this.db.many('select * from public.storefront_products where rank is not null order by rank, id limit 5'),
      this.db.many("select * from public.storefront_products where status in ('in','low') order by updated_at desc, id limit 5"),
      this.db.many('select * from public.store_events where is_visible order by sort_order, created_at'),
      this.categories(),
    ]);
    return {
      success: true as const,
      slides,
      featuredItems: featured.map(publicProduct),
      preorders: preorders.map(publicProduct),
      ranking: ranking.map(publicProduct),
      newInStock: newInStock.map(publicProduct),
      events,
      categories,
    };
  }

  async product(id: string): Promise<Row | null> {
    return this.db.one('select * from public.storefront_products where id = $1', [id]);
  }

  async inventory(variationIds: string[]) {
    const rows = await this.db.many<{ square_variation_id: string; quantity: number | null }>(
      'select square_variation_id, quantity from public.inventory_snapshots where square_variation_id = any($1::text[])',
      [variationIds.slice(0, 100)],
    );
    return Object.fromEntries(rows.map((r) => [r.square_variation_id, r.quantity]));
  }
}
