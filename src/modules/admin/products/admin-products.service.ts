import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { EmailService } from '../../../integrations/email/email.service.js';
import { CatalogService } from '../../catalog/catalog.service.js';
import type { PublicProduct } from '../../catalog/product.mapper.js';
import type { ProductQuery } from '../../catalog/dto/product-query.dto.js';
import { AdminLog } from '../admin-log.service.js';
import { sentFields } from '../dto/defined-fields.js';
import { CatalogSearchService } from './catalog-search.service.js';
import type { CatalogSearchQuery } from './dto/catalog-search.query.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import type { CatalogProductRow, ProductMetadataRow } from '../../../database/rows.js';

/** Managing products in the admin: finding them, editing their storefront details, and restock emails. */
@Injectable()
export class AdminProductsService {
  constructor(
    private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly search: CatalogSearchService,
    private readonly email: EmailService,
    private readonly log: AdminLog,
  ) {}

  /** Every catalog item (retired, hidden and unsellable too) for the admin list, with filter-chip totals. */
  async searchCatalog(query: CatalogSearchQuery) {
    const [page, counts] = await Promise.all([this.search.search(query), this.search.counts()]);
    return { ...page, counts };
  }

  /** Storefront products plus the admin-only fields the edit drawer needs. */
  async storefrontView(query: ProductQuery & { filter?: string }) {
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
    let items: PublicProduct[] = page.items;
    let total = page.total;
    if (filter === 'featured') {
      const featured = new Set(
        (
          await this.db.many<Pick<ProductMetadataRow, 'square_item_id'>>(
            'select square_item_id from public.product_metadata where is_featured',
          )
        ).map((r) => r.square_item_id),
      );
      items = items.filter((i) => featured.has(i.id));
      total = items.length;
    }
    if (items.length) items = await this.withAdminFields(items);
    return { ...page, items, total };
  }

  private async withAdminFields(items: PublicProduct[]) {
    const ids = items.map((i) => i.id);
    const variations = items.map((i) => i.variationId).filter(Boolean);
    const [meta, catalog, alerts] = await Promise.all([
      this.db.many<
        Pick<
          ProductMetadataRow,
          'square_item_id' | 'availability' | 'jan_code' | 'is_featured' | 'sort_order'
        >
      >(
        'select square_item_id, availability, jan_code, is_featured, sort_order from public.product_metadata where square_item_id = any($1::text[])',
        [ids],
      ),
      this.db.many<Pick<CatalogProductRow, 'square_item_id' | 'source' | 'description'>>(
        'select square_item_id, source, description from public.catalog_products where square_item_id = any($1::text[])',
        [ids],
      ),
      this.db.many<{ square_variation_id: string; n: number }>(
        'select square_variation_id, count(*)::int as n from public.stock_alerts where notified_at is null and square_variation_id = any($1::text[]) group by 1',
        [variations],
      ),
    ]);
    const metaById = new Map(meta.map((m) => [m.square_item_id, m]));
    const alertsByVariation = new Map(alerts.map((a) => [a.square_variation_id, a.n]));
    const catalogById = new Map(catalog.map((c) => [c.square_item_id, c]));
    return items.map((i) => {
      const m = metaById.get(i.id);
      return {
        ...i,
        janCode: m?.jan_code ?? null,
        availability: m?.availability ?? 'auto',
        isFeatured: m?.is_featured ?? false,
        sortOrder: m?.sort_order ?? 0,
        source: catalogById.get(i.id)?.source ?? 'square',
        description: catalogById.get(i.id)?.description ?? null,
        alertsWaiting: (i.variationId ? alertsByVariation.get(i.variationId) : undefined) ?? 0,
      };
    });
  }

  /** Saves the storefront details that were sent for a product. Works for Square and manual products alike. */
  async updateDetails(adminId: string, squareItemId: string, dto: UpdateProductDto) {
    const exists = await this.db.one(
      'select 1 from public.catalog_products where square_item_id = $1',
      [squareItemId],
    );
    if (!exists) throw notFound('Product');
    const changes = sentFields(dto);
    await this.assertCategoryExists(changes.category_id as string | null | undefined);
    const keys = Object.keys(changes);
    const columns = ['square_item_id', ...keys];
    const values = [squareItemId, ...keys.map((k) => changes[k])];
    const updates = keys.length
      ? keys.map((k) => `${k} = excluded.${k}`).join(', ')
      : 'square_item_id = excluded.square_item_id';
    return this.db.transaction(async (tx) => {
      const row = await this.db.one<ProductMetadataRow>(
        `insert into public.product_metadata (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})
         on conflict (square_item_id) do update set ${updates} returning *`,
        values,
        tx,
      );
      await this.log.write(adminId, 'product.updated', squareItemId, changes, tx);
      return row;
    });
  }

  /** Moves many products into one shop category, or clears their category with `null`. Returns how many changed. */
  async bulkCategory(adminId: string, ids: string[], categoryId: string | null) {
    await this.assertCategoryExists(categoryId);
    return this.db.transaction(async (tx) => {
      const rows = await this.db.many<Pick<ProductMetadataRow, 'square_item_id'>>(
        `insert into public.product_metadata (square_item_id, category_id)
         select c.square_item_id, $2::uuid from public.catalog_products c where c.square_item_id = any($1::text[])
         on conflict (square_item_id) do update set category_id = excluded.category_id returning square_item_id`,
        [ids, categoryId],
        tx,
      );
      await this.log.write(
        adminId,
        'product.bulk_category',
        categoryId ?? 'none',
        { count: rows.length },
        tx,
      );
      return rows.length;
    });
  }

  /** Emails everyone waiting for this product and marks them notified. Returns how many emails went out. */
  async notifyRestock(adminId: string, squareItemId: string) {
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
      const ok = await this.email.send(
        r.email,
        `${product.name} is back at Spin Hobby`,
        this.email.restockHtml(product.name),
      );
      if (ok) sent.push(r.id);
    }
    if (sent.length) {
      await this.db.exec(
        'update public.stock_alerts set notified_at = now() where id = any($1::uuid[])',
        [sent],
      );
    }
    await this.log.write(adminId, 'product.restock_notified', squareItemId, { sent: sent.length });
    return sent.length;
  }

  private async assertCategoryExists(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const found = await this.db.one('select 1 from public.store_categories where id = $1', [
      categoryId,
    ]);
    if (!found) throw new AppError('Category not found.', 404);
  }
}
