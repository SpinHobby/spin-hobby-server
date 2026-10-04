import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AdminLog } from '../common/admin-log.service.js';
import { AppError, notFound } from '../common/errors.js';
import { jsonBody } from '../common/validation.js';
import { categoryId } from './admin-categories.controller.js';
import { CatalogService, type ProductQuery } from '../catalog/catalog.service.js';
import { Db, type Row } from '../db/db.service.js';
import { CatalogSearchService, type CatalogQuery } from './catalog-search.service.js';
import { EmailService } from '../email/email.service.js';

const EDITABLE = [
  'availability',
  'release_month',
  'order_by_date',
  'series',
  'character',
  'manufacturer',
  'jan_code',
  'compare_at_cents',
  'max_per_customer',
  'deposit_cents',
  'is_featured',
  'sort_order',
  'category_id',
] as const;
const INTEGER_FIELDS = new Set([
  'compare_at_cents',
  'max_per_customer',
  'deposit_cents',
  'sort_order',
]);

@Controller('admin')
@Access('staff')
export class AdminCatalogController {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly search: CatalogSearchService,
    private readonly log: AdminLog,
    private readonly email: EmailService,
  ) {}

  @Get('dashboard')
  async dashboard() {
    const [orders, alerts, products, reserved] = await Promise.all([
      this.db.many(
        'select id, billing_email, total_cents, status, created_at from public.orders order by created_at desc limit 100',
      ),
      this.db.one<{ count: number }>(
        'select count(*)::int as count from public.stock_alerts where notified_at is null',
      ),
      this.db.many(
        'select id, name, variation_id, stock_count, status, order_by_date from public.storefront_products',
      ),
      this.db.one<{ units: number }>(
        `select coalesce(sum(i.quantity), 0)::int as units from public.order_items i
           join public.orders o on o.id = i.order_id where o.status = 'preorder_reserved' and i.is_preorder`,
      ),
    ]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const toShip = orders.filter((o) => o.status === 'paid');
    const preorders = orders.filter((o) => o.status === 'preorder_reserved');
    const low = products.filter((p) => p.status === 'low' || p.status === 'out');
    return {
      success: true,
      salesTodayCents: orders
        .filter(
          (o) =>
            new Date(o.created_at) >= today &&
            ['paid', 'preorder_reserved', 'fulfilled', 'shipped'].includes(o.status),
        )
        .reduce((t, o) => t + Number(o.total_cents), 0),
      toShip: toShip.length,
      oldestToShipDays: toShip.length
        ? Math.floor(
            (Date.now() - Math.min(...toShip.map((o) => new Date(o.created_at).getTime()))) /
              86_400_000,
          )
        : 0,
      openPreorders: preorders.length,
      preorderProducts: products.filter((p) => p.status === 'pre').length,
      ordersToday: orders.filter((o) => new Date(o.created_at) >= today).length,
      reservedUnits: reserved?.units ?? 0, // units, not orders (the edge function counted orders)
      lowStock: low.length,
      alertsWaiting: alerts?.count ?? 0,
      toShipList: toShip.slice(0, 8),
      lowStockList: low.slice(0, 8),
      closingPreorders: products
        .filter((p) => p.status === 'pre' && p.order_by_date)
        .sort((a, b) => String(a.order_by_date).localeCompare(String(b.order_by_date)))
        .slice(0, 8),
    };
  }

  /**
   * Every item in the catalog (including retired, hidden and unsellable ones) with search, filters, sorting and paging,
   * plus totals for the filter chips. The storefront-shaped GET products below only lists what shoppers can see.
   */
  @Get('catalog')
  async catalogItems(@Query() query: CatalogQuery) {
    const [page, counts] = await Promise.all([this.search.search(query), this.search.counts()]);
    return { success: true, ...page, counts };
  }

  /** Storefront products plus the admin-only fields the edit drawer needs. */
  @Get('products')
  async products(@Query() query: ProductQuery & { filter?: string }) {
    const filter = query.filter ?? 'all';
    const status =
      filter === 'in'
        ? 'in,low'
        : filter === 'low'
          ? 'low,out'
          : filter === 'pre'
            ? 'pre'
            : query.status;
    const page = await this.catalog.productPage({ ...query, status });
    let items: Row[] = page.items;
    let total = page.total;
    if (filter === 'featured') {
      const ids = new Set(
        (
          await this.db.many('select square_item_id from public.product_metadata where is_featured')
        ).map((r) => r.square_item_id),
      );
      items = items.filter((i) => ids.has(i.id));
      total = items.length;
    }
    if (items.length) {
      const ids = items.map((i) => i.id);
      const variations = items.map((i) => i.variationId).filter(Boolean);
      const [meta, catalog, alerts] = await Promise.all([
        this.db.many(
          'select square_item_id, availability, jan_code, is_featured, sort_order from public.product_metadata where square_item_id = any($1::text[])',
          [ids],
        ),
        this.db.many(
          'select square_item_id, source, description from public.catalog_products where square_item_id = any($1::text[])',
          [ids],
        ),
        this.db.many(
          'select square_variation_id, count(*)::int as n from public.stock_alerts where notified_at is null and square_variation_id = any($1::text[]) group by 1',
          [variations],
        ),
      ]);
      const metaById = new Map(meta.map((m) => [m.square_item_id, m]));
      const alertsByVar = new Map(alerts.map((a) => [a.square_variation_id, a.n]));
      const catalogById = new Map(catalog.map((c) => [c.square_item_id, c]));
      items = items.map((i) => {
        const m = metaById.get(i.id);
        return {
          ...i,
          janCode: m?.jan_code ?? null,
          availability: m?.availability ?? 'auto',
          isFeatured: m?.is_featured ?? false,
          sortOrder: m?.sort_order ?? 0,
          source: catalogById.get(i.id)?.source ?? 'square',
          description: catalogById.get(i.id)?.description ?? null,
          alertsWaiting: alertsByVar.get(i.variationId) ?? 0,
        };
      });
    }
    return { ...page, items, total };
  }

  @Patch('products/:id')
  async updateProduct(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Body() body: unknown,
  ) {
    const payload = jsonBody(body);
    const exists = await this.db.one(
      'select 1 from public.catalog_products where square_item_id = $1',
      [squareItemId],
    );
    if (!exists) throw notFound('Product');
    const changes: Row = {};
    for (const key of EDITABLE)
      if (key in payload) changes[key] = payload[key] === '' ? null : payload[key];
    if (
      changes.availability &&
      !['auto', 'preorder', 'backorder', 'hidden'].includes(changes.availability)
    )
      throw new AppError('Invalid availability.');
    for (const key of INTEGER_FIELDS) {
      if (
        changes[key] !== undefined &&
        changes[key] !== null &&
        (!Number.isInteger(Number(changes[key])) || Number(changes[key]) < 0)
      )
        throw new AppError(`Invalid ${key}.`);
    }
    if ('is_featured' in changes) changes.is_featured = changes.is_featured === true;
    if ('category_id' in changes) {
      changes.category_id = categoryId(changes.category_id);
      if (
        changes.category_id &&
        !(await this.db.one('select 1 from public.store_categories where id = $1', [
          changes.category_id,
        ]))
      )
        throw new AppError('Category not found.', 404);
    }
    const keys = Object.keys(changes);
    const columns = ['square_item_id', ...keys];
    const values = [squareItemId, ...keys.map((k) => changes[k])];
    const updates = keys.length
      ? keys.map((k) => `${k} = excluded.${k}`).join(', ')
      : 'square_item_id = excluded.square_item_id';
    const product = await this.db.transaction(async (tx) => {
      const row = await this.db.one(
        `insert into public.product_metadata (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         on conflict (square_item_id) do update set ${updates} returning *`,
        values,
        tx,
      );
      await this.log.write(admin.id, 'product.updated', squareItemId, changes, tx);
      return row;
    });
    return { success: true, product };
  }

  /** Moves many products into one shop category (or clears it with categoryId: null). */
  @Post('products/bulk-category')
  @HttpCode(200)
  async bulkCategory(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const p = jsonBody(body);
    const ids = p.ids;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== 'string')
    )
      throw new AppError('Select at least one product.');
    const target = categoryId(p.categoryId);
    if (
      target &&
      !(await this.db.one('select 1 from public.store_categories where id = $1', [target]))
    )
      throw new AppError('Category not found.', 404);
    const updated = await this.db.transaction(async (tx) => {
      const rows = await this.db.many(
        `insert into public.product_metadata (square_item_id, category_id)
         select c.square_item_id, $2::uuid from public.catalog_products c where c.square_item_id = any($1::text[])
         on conflict (square_item_id) do update set category_id = excluded.category_id returning square_item_id`,
        [ids, target],
        tx,
      );
      await this.log.write(
        admin.id,
        'product.bulk_category',
        target ?? 'none',
        { count: rows.length },
        tx,
      );
      return rows.length;
    });
    return { success: true, updated };
  }

  @Post('products/:id/notify-restock')
  @HttpCode(200)
  async notifyRestock(@CurrentUser() admin: AppUser, @Param('id') squareItemId: string) {
    const product = await this.db.one<{ name: string }>(
      'select name from public.catalog_products where square_item_id = $1',
      [squareItemId],
    );
    if (!product) throw notFound('Product');
    const recipients = await this.db.many<{ id: string; email: string }>(
      `select a.id, a.email from public.stock_alerts a
         join public.catalog_variations v on v.square_variation_id = a.square_variation_id
        where v.square_item_id = $1 and a.notified_at is null`,
      [squareItemId],
    );
    if (recipients.length && !this.email.configured)
      throw new AppError('Restock email is not configured.', 503);
    const sent: string[] = [];
    for (const r of recipients) {
      if (
        await this.email.send(
          r.email,
          `${product.name} is back at Spin Hobby`,
          this.email.restockHtml(product.name),
        )
      )
        sent.push(r.id);
    }
    if (sent.length)
      await this.db.exec(
        'update public.stock_alerts set notified_at = now() where id = any($1::uuid[])',
        [sent],
      );
    await this.log.write(admin.id, 'product.restock_notified', squareItemId, { sent: sent.length });
    return { success: true, sent: sent.length };
  }
}
