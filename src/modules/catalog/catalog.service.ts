import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { likePattern } from '../../common/validation/rules.js';
import { Db } from '../../database/db.service.js';
import type { HeroSlideRow, StoreEventRow, StorefrontProductRow } from '../../database/rows.js';
import type { ProductQuery } from './dto/product-query.dto.js';
import { FRONT_PAGE_SLOTS } from './front-page.js';
import { publicProduct } from './product.mapper.js';

const SORTS: Record<string, string> = {
  featured: 'is_featured desc, case when is_featured then sort_order end, created_at desc, id',
  new: 'created_at desc, id',
  release: 'release_month asc nulls last, id',
  price_asc: 'price_cents asc, id',
  price_desc: 'price_cents desc, id',
  pop: 'rank asc nulls last, id',
};

/** Storefront menu sections. Category groups match by keyword on the shop category path or Square category. */
export const GROUPS: Record<string, { status?: string[]; sale?: boolean; pattern?: string }> = {
  new: { status: ['in', 'low'] },
  preorders: { status: ['pre'] },
  sale: { sale: true },
  figures: { pattern: 'figure|figma|nendoroid|model kit|gunpla|statue' },
  plushies: { pattern: 'plush' },
  cards: { pattern: 'card|tcg' },
  goods: { pattern: 'badge|acrylic|keychain|blind|apparel|poster|tapestry|goods|sticker|stand' },
  media: { pattern: 'book|doujin|manga|video|music|media|\\mcd\\M|dvd|blu-?ray' }, // \\m \\M = Postgres word boundaries
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Full "Parent › Child" path for every shop category, so filters can match a whole branch.
const CATEGORY_PATHS = `with recursive cat_paths as (
  select id, name::text as path, array[id] as lineage from public.store_categories where parent_id is null
  union all
  select c.id, cp.path || ' › ' || c.name, cp.lineage || c.id from public.store_categories c join cat_paths cp on c.parent_id = cp.id
)`;

function defaultSlides(freeShippingDollars: number) {
  const amount = Number.isInteger(freeShippingDollars)
    ? String(freeShippingDollars)
    : freeShippingDollars.toFixed(2);
  return [
    ['New arrivals every week', 'Fresh figures, badges and plushies added regularly.'],
    [`Free shipping on orders $${amount}+`, 'Across Canada & the US, tracked.'],
    ['Join our Discord community', 'Restock alerts and exclusive drops first.'],
  ].map(([headline, subheading], i) => ({
    id: `default-${i}`,
    headline,
    subheading,
    image_url: null,
    link_url: null,
    sort_order: i,
    is_visible: true,
    is_default: true,
  }));
}

const DEFAULT_EVENTS = [
  'Edmonton Collector Con',
  'Calgary Expo',
  'Otafest',
  'Animethon',
  'Edmonton Expo',
].map((name, i) => ({
  id: `default-${i}`,
  name,
  city: null,
  start_date: null,
  end_date: null,
  booth_info: null,
  is_visible: true,
  sort_order: i,
  is_default: true,
}));

@Injectable()
export class CatalogService {
  constructor(private readonly db: Db) {}

  async productPage(query: ProductQuery) {
    const limit = Math.min(Math.max(Number(query.limit ?? 24) || 24, 1), 60);
    const offset = Math.max(Number(query.cursor ?? 0) || 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(clause(`$${params.length}`));
    };

    const category = query.category?.trim().slice(0, 120);
    if (category) add((n) => `category = ${n}`, category);
    if (query.categoryId) {
      if (!UUID.test(query.categoryId)) throw new AppError('Invalid category.');
      add(
        (n) => `category_id in (select id from cat_paths where ${n}::uuid = any(lineage))`,
        query.categoryId,
      );
    }
    const group = query.group ? GROUPS[query.group] : undefined;
    if (query.group && !group) throw new AppError('Unknown section.');
    if (group?.status) add((n) => `status = any(${n}::text[])`, group.status);
    if (group?.sale) where.push('compare_at_cents > price_cents');
    if (group?.pattern)
      add(
        (n) =>
          `(coalesce((select path from cat_paths where cat_paths.id = sp.category_id), '') || ' ' || coalesce(sp.category, '')) ~* ${n}`,
        group.pattern,
      );
    const statuses = (query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (statuses.length) add((n) => `status = any(${n}::text[])`, statuses);
    const ids = (query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (query.ids !== undefined && query.ids !== null) add((n) => `id = any(${n}::text[])`, ids);
    const min = Number(query.min);
    const max = Number(query.max);
    if (query.min != null && query.min !== '' && Number.isFinite(min) && min >= 0)
      add((n) => `price_cents >= ${n}`, Math.round(min * 100));
    if (query.max != null && query.max !== '' && Number.isFinite(max) && max >= 0)
      add((n) => `price_cents < ${n}`, Math.round(max * 100));
    const q = query.q?.trim();
    if (q)
      add(
        (
          n,
        ) => `(name ilike ${n} or series ilike ${n} or character ilike ${n} or jan_code ilike ${n} or category ilike ${n}
      or exists (select 1 from cat_paths where cat_paths.id = sp.category_id and cat_paths.path ilike ${n}))`,
        likePattern(q),
      );

    const filter = where.length ? `where ${where.join(' and ')}` : '';
    const order = SORTS[query.sort ?? 'new'] ?? SORTS.new;
    const [rows, count] = await Promise.all([
      this.db.many<StorefrontProductRow>(
        `${CATEGORY_PATHS} select sp.* from public.storefront_products sp ${filter} order by ${order} limit ${limit} offset ${offset}`,
        params,
      ),
      this.db.one<{ total: number }>(
        `${CATEGORY_PATHS} select count(*)::int as total from public.storefront_products sp ${filter}`,
        params,
      ),
    ]);
    const total = count?.total ?? 0;
    const next = offset + rows.length;
    return {
      success: true as const,
      items: rows.map(publicProduct),
      total,
      ...(next < total ? { cursor: String(next) } : {}),
    };
  }

  async facets() {
    const [rows, categories] = await Promise.all([
      this.db.many<{
        category: string | null;
        category_id: string | null;
        status: string;
        price_cents: number;
      }>('select category, category_id, status, price_cents from public.storefront_products'),
      this.categories(),
    ]);
    const squareCategories = new Map<string, number>();
    const status = { in: 0, pre: 0, out: 0 };
    const buckets = [
      { label: 'Under $25', min: 0, max: 25 as number | null, count: 0 },
      { label: '$25–75', min: 25, max: 75 as number | null, count: 0 },
      { label: '$75–150', min: 75, max: 150 as number | null, count: 0 },
      { label: '$150+', min: 150, max: null as number | null, count: 0 },
    ];
    // Totals per shop category include everything in its subcategories.
    const parent = new Map(categories.map((c) => [c.id, c.parentId]));
    const categoryTotals: Record<string, number> = {};
    for (const row of rows) {
      if (row.category)
        squareCategories.set(row.category, (squareCategories.get(row.category) ?? 0) + 1);
      if (row.status === 'in' || row.status === 'low') status.in += 1;
      else if (row.status === 'pre') status.pre += 1;
      else if (row.status === 'out' || row.status === 'closed') status.out += 1;
      const price = Number(row.price_cents) / 100;
      const bucket = buckets.find((b) => price >= b.min && (b.max === null || price < b.max));
      if (bucket) bucket.count += 1;
      for (
        let at = row.category_id, guard = 0;
        at && parent.has(at) && guard < 50;
        at = parent.get(at) ?? null, guard++
      ) {
        categoryTotals[at] = (categoryTotals[at] ?? 0) + 1;
      }
    }
    return {
      success: true as const,
      total: rows.length,
      categories: [...squareCategories]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      shopCategories: categories
        .filter((c) => categoryTotals[c.id])
        .map((c) => ({ ...c, total: categoryTotals[c.id] })),
      status,
      price: buckets,
    };
  }

  /** Visible shop categories as a flat list (parentId links build the tree). */
  async categories() {
    const rows = await this.db.many<{
      id: string;
      parent_id: string | null;
      name: string;
      sort_order: number;
    }>(
      'select id, parent_id, name, sort_order from public.store_categories where is_visible order by sort_order, name',
    );
    // A hidden category hides its whole branch from navigation.
    const visible = new Set(rows.map((r) => r.id));
    const ok = (r: { parent_id: string | null }): boolean =>
      r.parent_id === null ||
      (visible.has(r.parent_id) && ok(rows.find((x) => x.id === r.parent_id)!));
    return rows
      .filter(ok)
      .map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name, sortOrder: r.sort_order }));
  }

  async homepage() {
    const [slides, featured, preorders, ranking, newInStock, events, categories, settings, promo] =
      await Promise.all([
        this.db.many<HeroSlideRow>(
          'select * from public.hero_slides where is_visible order by sort_order, created_at',
        ),
        this.db.many<StorefrontProductRow>(
          `select * from public.storefront_products where is_featured order by sort_order, id limit ${FRONT_PAGE_SLOTS}`,
        ),
        this.db.many<StorefrontProductRow>(
          "select * from public.storefront_products where status = 'pre' order by order_by_date asc nulls last, id limit 12",
        ),
        this.db.many<StorefrontProductRow>(
          'select * from public.storefront_products where rank is not null order by rank, id limit 5',
        ),
        this.db.many<StorefrontProductRow>(
          "select * from public.storefront_products where status in ('in','low') order by created_at desc, id limit 5",
        ),
        this.db.many<StoreEventRow>(
          'select * from public.store_events where is_visible order by sort_order, created_at',
        ),
        this.categories(),
        this.db.one<{ free_shipping_threshold_cents: number }>(
          'select free_shipping_threshold_cents from public.store_settings where id = true',
        ),
        this.db.one<{ closing_soon: number; max_discount: number }>(
          `select count(*) filter (where status = 'pre' and order_by_date between now() - interval '1 day' and now() + interval '30 days')::int as closing_soon,
                coalesce(max(round((1 - price_cents::numeric / compare_at_cents) * 100)) filter (where compare_at_cents > price_cents), 0)::int as max_discount
           from public.storefront_products`,
        ),
      ]);
    const free = Number(settings?.free_shipping_threshold_cents ?? 7500) / 100;
    return {
      success: true as const,
      // Until staff add their own, the storefront shows these welcome slides and convention list.
      slides: slides.length ? slides : defaultSlides(free),
      featuredItems: featured.map(publicProduct),
      preorders: preorders.map(publicProduct),
      ranking: ranking.map(publicProduct),
      newInStock: newInStock.map(publicProduct),
      events: events.length ? events : DEFAULT_EVENTS,
      categories,
      // Numbers for the two promo cards beside the hero.
      promos: { closingSoon: promo?.closing_soon ?? 0, maxDiscountPct: promo?.max_discount ?? 0 },
      freeShippingThresholdCents: Math.round(free * 100),
    };
  }

  async product(id: string): Promise<StorefrontProductRow | null> {
    return this.db.one<StorefrontProductRow>(
      'select * from public.storefront_products where id = $1',
      [id],
    );
  }

  async inventory(variationIds: string[]) {
    const rows = await this.db.many<{ square_variation_id: string; quantity: number | null }>(
      'select square_variation_id, quantity from public.inventory_snapshots where square_variation_id = any($1::text[])',
      [variationIds.slice(0, 100)],
    );
    return Object.fromEntries(rows.map((r) => [r.square_variation_id, r.quantity]));
  }
}
