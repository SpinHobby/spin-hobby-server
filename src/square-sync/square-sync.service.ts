import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';
import { Db, type Queryable, type Row } from '../db/db.service.js';
import { SquareClient } from '../payments/square.client.js';

export interface SyncResult { products: number; variations: number; inventory: number; completedAt: string }

const chunks = <T>(values: T[], size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, i * size + size));

/**
 * Mirrors the Square catalog (items, variations, images) and IN_STOCK inventory into Postgres.
 * Square stays the source of truth; storefront-only fields live in product_metadata and are untouched.
 */
@Injectable()
export class SquareSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SquareSyncService.name);
  private running: Promise<SyncResult> | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private readonly db: Db, private readonly square: SquareClient) {}

  onModuleInit() {
    const minutes = Number(env('SQUARE_SYNC_INTERVAL_MINUTES') ?? 0);
    if (minutes > 0) {
      this.timer = setInterval(() => this.run().catch((e) => this.logger.error(`Scheduled Square sync failed: ${e.message}`)), minutes * 60_000);
      this.timer.unref();
      this.logger.log(`Square sync scheduled every ${minutes} min.`);
    }
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Concurrent callers share the in-flight run instead of starting a second one. */
  run(): Promise<SyncResult> {
    if (!env('SQUARE_ACCESS_TOKEN')) return Promise.reject(new AppError('Square catalog sync is not configured.', 503));
    this.running ??= this.runOnce().finally(() => { this.running = null; });
    return this.running;
  }

  private async runOnce(): Promise<SyncResult> {
    const started = Date.now();
    const categories = await this.categoryNames();
    let cursor: string | undefined;
    let products = 0;
    let variations = 0;
    const variationIds: string[] = [];
    do {
      const data = await this.square.request('/v2/catalog/search-catalog-items', {
        product_types: ['REGULAR'], include_related_objects: true, limit: 100, ...(cursor ? { cursor } : {}),
      });
      const items: Row[] = data.items ?? [];
      const result = await this.db.transaction((tx) => this.upsertPage(tx, items, data.related_objects ?? [], categories));
      products += result.products;
      variations += result.variations;
      for (const item of items) for (const v of item.item_data?.variations ?? []) if (!v.is_deleted) variationIds.push(v.id);
      cursor = data.cursor;
    } while (cursor);
    const inventory = await this.syncInventory(variationIds);
    this.logger.log(`Square sync: ${products} products, ${variations} variations, ${inventory} stock counts in ${Date.now() - started} ms`);
    return { products, variations, inventory, completedAt: new Date().toISOString() };
  }

  private async categoryNames() {
    const names = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const data = await this.square.request('/v2/catalog/search', { object_types: ['CATEGORY'], include_deleted_objects: false, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const o of data.objects ?? []) if (o.type === 'CATEGORY' && o.category_data?.name) names.set(o.id, o.category_data.name);
      cursor = data.cursor;
    } while (cursor);
    return names;
  }

  private async upsertPage(tx: Queryable, items: Row[], related: Row[], categories: Map<string, string>) {
    const images = new Map(related.filter((o) => o.type === 'IMAGE').map((o) => [o.id, o.image_data?.url as string | undefined]));
    const catalogItems = items.filter((i) => i.type === 'ITEM' && i.item_data);
    let variationCount = 0;
    for (const item of catalogItems) {
      const d = item.item_data;
      // Newer Square items carry `categories`; older ones only `category_id`.
      const categoryIds: string[] = d.categories?.map((c: Row) => c.id) ?? (d.category_id ? [d.category_id] : []);
      const primary = d.reporting_category?.id ?? categoryIds[0] ?? null;
      await this.db.exec(
        `insert into public.catalog_products (square_item_id, name, description, category, category_ids, default_variation_id, is_active, is_visible, square_updated_at, synced_at)
         values ($1, $2, $3, $4, $5, null, $6, $6, $7, now())
         on conflict (square_item_id) do update set name = excluded.name, description = excluded.description, category = excluded.category,
           category_ids = excluded.category_ids, is_active = excluded.is_active, is_visible = excluded.is_visible,
           square_updated_at = excluded.square_updated_at, synced_at = now()`,
        [item.id, d.name, d.description_plaintext ?? d.description ?? null, primary ? categories.get(primary) ?? primary : null, categoryIds, !item.is_deleted, item.updated_at ?? null],
        tx,
      );
      for (const v of d.variations ?? []) {
        const vd = v.item_variation_data ?? {};
        await this.db.exec(
          `insert into public.catalog_variations (square_variation_id, square_item_id, name, sku, price_cents, currency, is_sellable, square_updated_at, synced_at)
           values ($1, $2, $3, $4, $5, 'CAD', $6, $7, now())
           on conflict (square_variation_id) do update set square_item_id = excluded.square_item_id, name = excluded.name, sku = excluded.sku,
             price_cents = excluded.price_cents, is_sellable = excluded.is_sellable, square_updated_at = excluded.square_updated_at, synced_at = now()`,
          [v.id, item.id, vd.name ?? null, vd.sku ?? null, Number(vd.price_money?.amount ?? 0), !v.is_deleted, v.updated_at ?? item.updated_at ?? null],
          tx,
        );
        variationCount += 1;
      }
      const firstVariation = d.variations?.find((v: Row) => !v.is_deleted)?.id ?? null;
      await this.db.exec('update public.catalog_products set default_variation_id = $2 where square_item_id = $1', [item.id, firstVariation], tx);
      await this.db.exec('delete from public.product_images where square_item_id = $1', [item.id], tx);
      const imageRows = (d.image_ids ?? []).map((imageId: string, sort: number) => ({ imageId, url: images.get(imageId), sort })).filter((r: Row) => r.url);
      for (const r of imageRows) {
        await this.db.exec(
          `insert into public.product_images (square_item_id, square_image_id, image_url, sort_order) values ($1, $2, $3, $4)
           on conflict (square_image_id) do update set square_item_id = excluded.square_item_id, image_url = excluded.image_url, sort_order = excluded.sort_order`,
          [item.id, r.imageId, r.url, r.sort],
          tx,
        );
      }
    }
    return { products: catalogItems.length, variations: variationCount };
  }

  private async syncInventory(variationIds: string[]) {
    const locationId = env('SQUARE_LOCATION_ID');
    if (!locationId || !variationIds.length) return 0;
    let synced = 0;
    for (const ids of chunks(variationIds)) {
      const quantities = new Map<string, number>();
      let cursor: string | undefined;
      do {
        const data = await this.square.request('/v2/inventory/counts/batch-retrieve', {
          catalog_object_ids: ids, location_ids: [locationId], states: ['IN_STOCK'], ...(cursor ? { cursor } : {}),
        });
        for (const c of data.counts ?? []) quantities.set(c.catalog_object_id, (quantities.get(c.catalog_object_id) ?? 0) + Number(c.quantity ?? 0));
        cursor = data.cursor;
      } while (cursor);
      await this.db.transaction(async (tx) => {
        for (const id of ids) {
          await this.db.exec(
            `insert into public.inventory_snapshots (square_variation_id, quantity, synced_at) values ($1, $2, now())
             on conflict (square_variation_id) do update set quantity = excluded.quantity, synced_at = now()`,
            [id, Math.max(0, quantities.get(id) ?? 0)], tx,
          );
        }
      });
      synced += ids.length;
    }
    return synced;
  }
}
