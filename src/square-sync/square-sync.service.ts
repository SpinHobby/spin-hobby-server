import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/errors.js';
import { env } from '../config/env.js';
import { Db, type Queryable, type Row } from '../db/db.service.js';
import { SquareClient } from '../payments/square.client.js';

export interface SyncResult { products: number; variations: number; inventory: number; retired: number; completedAt: string }

const chunks = <T>(values: T[], size = 100) => Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, i * size + size));

/** Most of the active Square catalog one sync may retire before we assume Square returned a partial list. */
const retireMaxRatio = () => {
  const ratio = Number(env('SQUARE_SYNC_RETIRE_MAX_RATIO') ?? 0.5);
  return Number.isFinite(ratio) && ratio >= 0 ? ratio : 0.5;
};

/**
 * Mirrors the Square catalog (items, variations, images) and IN_STOCK inventory into Postgres.
 * Square stays the source of truth; storefront-only fields live in product_metadata and are untouched.
 * Each page is written with a handful of set-based statements rather than a query per row.
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
      this.timer = setInterval(
        () => void this.run().catch((e) => this.logger.error(`Scheduled Square sync failed: ${e.message}`)),
        minutes * 60_000,
      );
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
    const seenItems = new Set<string>();
    const tracked: string[] = [];
    const untracked: string[] = [];
    do {
      const data = await this.square.request('/v2/catalog/search-catalog-items', {
        product_types: ['REGULAR'], include_related_objects: true, limit: 100, ...(cursor ? { cursor } : {}),
      });
      const items: Row[] = data.items ?? [];
      const result = await this.db.transaction((tx) => this.upsertPage(tx, items, data.related_objects ?? [], categories));
      products += result.products;
      variations += result.variations;
      for (const item of items) {
        if (item.type !== 'ITEM' || !item.item_data) continue;
        seenItems.add(item.id);
        for (const v of item.item_data.variations ?? []) {
          if (v.is_deleted) continue;
          // Square only counts stock for variations with tracking on; an explicit `false` means "sell freely".
          (v.item_variation_data?.track_inventory === false ? untracked : tracked).push(v.id);
        }
      }
      cursor = data.cursor;
    } while (cursor);
    const inventory = await this.syncInventory(tracked, untracked);
    // Only a pass that read the whole catalog may retire anything.
    const retired = await this.retireMissing(seenItems);
    this.logger.log(`Square sync: ${products} products, ${variations} variations, ${inventory} stock counts, ${retired} retired in ${Date.now() - started} ms`);
    return { products, variations, inventory, retired, completedAt: new Date().toISOString() };
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
    if (!catalogItems.length) return { products: 0, variations: 0 };

    const productRows: Row[] = [];
    const variationRows: Row[] = [];
    const imageRows = new Map<string, Row>(); // keyed by Square image id; a shared image goes to the last item, as before
    for (const item of catalogItems) {
      const d = item.item_data;
      // Newer Square items carry `categories`; older ones only `category_id`.
      const categoryIds: string[] = d.categories?.map((c: Row) => c.id) ?? (d.category_id ? [d.category_id] : []);
      const primary = d.reporting_category?.id ?? categoryIds[0] ?? null;
      const live = (d.variations ?? []).filter((v: Row) => !v.is_deleted);
      productRows.push({
        id: item.id, name: d.name, description: d.description_plaintext ?? d.description ?? null,
        category: primary ? categories.get(primary) ?? primary : null, category_ids: categoryIds,
        default_variation_id: live[0]?.id ?? null, active: !item.is_deleted, updated_at: item.updated_at ?? null,
      });
      for (const v of d.variations ?? []) {
        const vd = v.item_variation_data ?? {};
        variationRows.push({
          id: v.id, item_id: item.id, name: vd.name ?? null, sku: vd.sku ?? null,
          price: Number(vd.price_money?.amount ?? 0), sellable: !v.is_deleted, updated_at: v.updated_at ?? item.updated_at ?? null,
        });
      }
      (d.image_ids ?? []).forEach((imageId: string, sort: number) => {
        const url = images.get(imageId);
        if (url) imageRows.set(imageId, { item_id: item.id, image_id: imageId, url, sort });
      });
    }

    await this.db.exec(
      `insert into public.catalog_products (square_item_id, name, description, category, category_ids, default_variation_id, is_active, is_visible, square_updated_at, synced_at)
       select r.id, r.name, r.description, r.category, array(select jsonb_array_elements_text(r.category_ids)), r.default_variation_id, r.active, r.active, r.updated_at, now()
         from jsonb_to_recordset($1::jsonb) as r(id text, name text, description text, category text, category_ids jsonb, default_variation_id text, active boolean, updated_at timestamptz)
       on conflict (square_item_id) do update set name = excluded.name, description = excluded.description, category = excluded.category,
         category_ids = excluded.category_ids, default_variation_id = excluded.default_variation_id, is_active = excluded.is_active,
         is_visible = excluded.is_visible, square_updated_at = excluded.square_updated_at, synced_at = now()`,
      [JSON.stringify(productRows)], tx,
    );
    if (variationRows.length) {
      await this.db.exec(
        `insert into public.catalog_variations (square_variation_id, square_item_id, name, sku, price_cents, currency, is_sellable, square_updated_at, synced_at)
         select r.id, r.item_id, r.name, r.sku, r.price, 'CAD', r.sellable, r.updated_at, now()
           from jsonb_to_recordset($1::jsonb) as r(id text, item_id text, name text, sku text, price integer, sellable boolean, updated_at timestamptz)
         on conflict (square_variation_id) do update set square_item_id = excluded.square_item_id, name = excluded.name, sku = excluded.sku,
           price_cents = excluded.price_cents, is_sellable = excluded.is_sellable, square_updated_at = excluded.square_updated_at, synced_at = now()`,
        [JSON.stringify(variationRows)], tx,
      );
    }
    // A variation Square no longer lists for an item can't be bought, but stays so old orders keep their reference.
    await this.db.exec(
      `update public.catalog_variations set is_sellable = false, synced_at = now()
        where square_item_id = any($1::text[]) and is_sellable and square_variation_id <> all($2::text[])`,
      [catalogItems.map((i) => i.id), variationRows.map((v) => v.id)], tx,
    );
    await this.db.exec('delete from public.product_images where square_item_id = any($1::text[])', [catalogItems.map((i) => i.id)], tx);
    if (imageRows.size) {
      await this.db.exec(
        `insert into public.product_images (square_item_id, square_image_id, image_url, sort_order)
         select r.item_id, r.image_id, r.url, r.sort
           from jsonb_to_recordset($1::jsonb) as r(item_id text, image_id text, url text, sort integer)
         on conflict (square_image_id) do update set square_item_id = excluded.square_item_id, image_url = excluded.image_url, sort_order = excluded.sort_order`,
        [JSON.stringify([...imageRows.values()])], tx,
      );
    }
    return { products: catalogItems.length, variations: variationRows.length };
  }

  private async syncInventory(tracked: string[], untracked: string[]) {
    const locationId = env('SQUARE_LOCATION_ID');
    if (!locationId || !(tracked.length + untracked.length)) return 0;
    let synced = 0;
    for (const ids of chunks(untracked)) {
      await this.writeInventory(ids.map((id) => ({ id, quantity: null })), new Date());
      synced += ids.length;
    }
    for (const ids of chunks(tracked)) {
      // Stamped with when we started reading, so a sale made while we read still counts as unreflected (see QuoteService.held).
      const readAt = new Date();
      const quantities = new Map<string, number>();
      let cursor: string | undefined;
      do {
        const data = await this.square.request('/v2/inventory/counts/batch-retrieve', {
          catalog_object_ids: ids, location_ids: [locationId], states: ['IN_STOCK'], ...(cursor ? { cursor } : {}),
        });
        for (const c of data.counts ?? []) quantities.set(c.catalog_object_id, (quantities.get(c.catalog_object_id) ?? 0) + Number(c.quantity ?? 0));
        cursor = data.cursor;
      } while (cursor);
      await this.writeInventory(ids.map((id) => ({ id, quantity: Math.max(0, quantities.get(id) ?? 0) })), readAt);
      synced += ids.length;
    }
    return synced;
  }

  private async writeInventory(rows: { id: string; quantity: number | null }[], readAt: Date) {
    await this.db.exec(
      `insert into public.inventory_snapshots (square_variation_id, quantity, synced_at)
       select r.id, r.quantity, $2::timestamptz from jsonb_to_recordset($1::jsonb) as r(id text, quantity integer)
       on conflict (square_variation_id) do update set quantity = excluded.quantity, synced_at = excluded.synced_at`,
      [JSON.stringify(rows), readAt.toISOString()],
    );
  }

  /**
   * Hides Square-sourced products that Square no longer returns (deleted there). Hand-entered products are never
   * touched. Refuses to act on an empty or suspiciously small result, which more likely means a partial read than a purge.
   */
  private async retireMissing(seen: Set<string>) {
    if (!seen.size) {
      this.logger.warn('Square returned no items; nothing was retired.');
      return 0;
    }
    const active = await this.db.many<Row>("select square_item_id from public.catalog_products where source = 'square' and is_active");
    const missing = active.map((r) => r.square_item_id as string).filter((id) => !seen.has(id));
    if (!missing.length) return 0;
    if (missing.length / active.length > retireMaxRatio()) {
      this.logger.warn(`Square sync would retire ${missing.length} of ${active.length} products (limit ${retireMaxRatio() * 100}%); skipped. Raise SQUARE_SYNC_RETIRE_MAX_RATIO if this is intentional.`);
      return 0;
    }
    await this.db.exec('update public.catalog_products set is_active = false, synced_at = now() where square_item_id = any($1::text[])', [missing]);
    this.logger.log(`Retired ${missing.length} product(s) deleted in Square.`);
    return missing.length;
  }
}
