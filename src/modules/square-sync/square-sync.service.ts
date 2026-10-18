import { inventoryEvents } from '../../common/inventory-events.js';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppError, errorText } from '../../common/errors.js';
import { Db, type Queryable } from '../../database/db.service.js';
import type { CatalogProductRow } from '../../database/rows.js';
import { SquareHttpClient } from '../../integrations/square/square-http.client.js';
import {
  squareAccessToken,
  squareLocationId,
  squareSyncIntervalMinutes,
  squareSyncRetireMaxRatio,
} from '../../config/square.config.js';
import type { ExternalJson } from '../../common/external-json.js';
import { PhotoCleanupService } from '../catalog/photo-cleanup.service.js';
import { isHiddenFromWebsite } from '../../integrations/square/visibility.js';
import { mapCatalogPage } from './square-sync.mapper.js';

export interface SyncResult {
  products: number;
  variations: number;
  inventory: number;
  retired: number;
  completedAt: string;
}

const chunks = <T>(values: T[], size = 100) =>
  Array.from({ length: Math.ceil(values.length / size) }, (_, i) =>
    values.slice(i * size, i * size + size),
  );

/** Most of the active Square catalog one sync may retire before we assume Square returned a partial list. */
const retireMaxRatio = () => {
  const ratio = squareSyncRetireMaxRatio();
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

  constructor(
    private readonly db: Db,
    private readonly square: SquareHttpClient,
    private readonly photos: PhotoCleanupService,
  ) {}

  onModuleInit() {
    const minutes = squareSyncIntervalMinutes();
    if (minutes > 0) {
      this.timer = setInterval(
        () =>
          void this.run().catch((e) =>
            this.logger.error(`Scheduled Square sync failed: ${e.message}`),
          ),
        minutes * 60_000,
      );
      this.timer.unref();
      this.logger.log(`Square sync scheduled every ${minutes} min.`);
    }
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    clearTimeout(this.requested);
  }

  /** Concurrent callers share the in-flight run instead of starting a second one. */
  run(): Promise<SyncResult> {
    if (!squareAccessToken())
      return Promise.reject(new AppError('Square catalog sync is not configured.', 503));
    this.running ??= this.runOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async runOnce(): Promise<SyncResult> {
    const started = Date.now();
    const categories = await this.categoryNames();
    let cursor: string | undefined;
    let products = 0;
    let hidden = 0;
    let variations = 0;
    const seenItems = new Set<string>();
    const tracked: string[] = [];
    const untracked: string[] = [];
    do {
      const data = await this.square.request('/v2/catalog/search-catalog-items', {
        product_types: ['REGULAR'],
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      const items: ExternalJson[] = data.items ?? [];
      const images = await this.imageObjects(items);
      const result = await this.db.transaction((tx) =>
        this.upsertPage(tx, items, images, categories),
      );
      products += result.products;
      variations += result.variations;
      for (const item of items) {
        if (item.type !== 'ITEM' || !item.item_data) continue;
        seenItems.add(item.id);
        if (isHiddenFromWebsite(item)) hidden += 1;
      }
      this.collectVariations(items, tracked, untracked);
      cursor = data.cursor;
    } while (cursor);
    const inventory = await this.syncInventory(tracked, untracked);
    // Only a pass that read the whole catalog may retire anything.
    const retired = await this.retireMissing(seenItems);
    await this.tidyPhotos();
    this.logger.log(
      `Square sync: ${products} products, ${variations} variations, ${inventory} stock counts, ${retired} retired, ${hidden} hidden from the website in ${Date.now() - started} ms`,
    );
    return { products, variations, inventory, retired, completedAt: new Date().toISOString() };
  }

  /** Sorts the live variations of these items into those Square counts stock for and those it does not. */
  private collectVariations(items: ExternalJson[], tracked: string[], untracked: string[]) {
    for (const item of items) {
      if (item.type !== 'ITEM' || !item.item_data) continue;
      for (const v of item.item_data.variations ?? []) {
        if (v.is_deleted) continue;
        // Square only counts stock for variations with tracking on; an explicit `false` means "sell freely".
        (v.item_variation_data?.track_inventory === false ? untracked : tracked).push(v.id);
      }
    }
  }

  /** Frees the storage of photos left behind by products that were moved into Square. Never fails a sync. */
  private async tidyPhotos() {
    try {
      const removed = await this.photos.purgeReplacedProducts();
      if (removed)
        this.logger.log(`Removed ${removed} leftover photo(s) of products moved into Square.`);
    } catch (error) {
      this.logger.warn(
        `Could not clean up leftover photos (will retry next sync): ${errorText(error)}`,
      );
    }
  }

  /**
   * Brings just these Square items (and their stock) into the database right now, without a full sync.
   * Used right after a product is created in Square, so it shows up immediately.
   */
  async syncItems(itemIds: string[]): Promise<{ products: number; variations: number }> {
    if (!squareAccessToken()) throw new AppError('Square catalog sync is not configured.', 503);
    let products = 0;
    let variations = 0;
    const tracked: string[] = [];
    const untracked: string[] = [];
    const categories = await this.categoryNames();
    for (const batch of chunks(itemIds, 1000)) {
      const data = await this.square.request('/v2/catalog/batch-retrieve', { object_ids: batch });
      const items = ((data.objects ?? []) as ExternalJson[]).filter((o) => o.type === 'ITEM');
      const images = await this.imageObjects(items);
      const result = await this.db.transaction((tx) =>
        this.upsertPage(tx, items, images, categories),
      );
      products += result.products;
      variations += result.variations;
      this.collectVariations(items, tracked, untracked);
    }
    await this.syncInventory(tracked, untracked);
    return { products, variations };
  }

  private requested?: NodeJS.Timeout;

  /**
   * Asks for a full sync soon. Square tells us (a webhook) that something in the catalog changed; a burst of
   * changes becomes one sync, started once things go quiet. If a sync is already running it finishes first,
   * so a change that arrived mid-run is never missed.
   */
  requestSync(delayMs = 20_000) {
    if (this.requested || !squareAccessToken()) return;
    this.requested = setTimeout(() => {
      this.requested = undefined;
      void (async () => {
        await this.running?.catch(() => undefined);
        await this.run();
      })().catch((e: unknown) =>
        this.logger.error(`Requested Square sync failed: ${errorText(e)}`),
      );
    }, delayMs);
    this.requested.unref();
  }

  /**
   * The picture records (with their URLs) for one page of items. Square's item search does not return related
   * objects, only the image ids on each item, so the pictures are looked up here, up to 1,000 ids per request.
   */
  private async imageObjects(items: ExternalJson[]): Promise<ExternalJson[]> {
    const ids = [
      ...new Set(items.flatMap((item) => (item.item_data?.image_ids ?? []) as string[])),
    ];
    const found: ExternalJson[] = [];
    for (const batch of chunks(ids, 1000)) {
      const data = await this.square.request('/v2/catalog/batch-retrieve', { object_ids: batch });
      found.push(...((data.objects ?? []) as ExternalJson[]));
    }
    return found;
  }

  private async categoryNames() {
    const names = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const data = await this.square.request('/v2/catalog/search', {
        object_types: ['CATEGORY'],
        include_deleted_objects: false,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      for (const o of data.objects ?? [])
        if (o.type === 'CATEGORY' && o.category_data?.name) names.set(o.id, o.category_data.name);
      cursor = data.cursor;
    } while (cursor);
    return names;
  }

  private async upsertPage(
    tx: Queryable,
    items: ExternalJson[],
    related: ExternalJson[],
    categories: Map<string, string>,
  ) {
    const { catalogItems, productRows, variationRows, imageRows } = mapCatalogPage(
      items,
      related,
      categories,
    );
    if (!catalogItems.length) return { products: 0, variations: 0 };

    await this.db.exec(
      `insert into public.catalog_products (square_item_id, name, description, category, category_ids, default_variation_id, is_active, is_visible, square_updated_at, square_created_at, synced_at)
       select r.id, r.name, r.description, r.category, array(select jsonb_array_elements_text(r.category_ids)), r.default_variation_id, r.active, r.visible, r.updated_at, r.created_at, now()
         from jsonb_to_recordset($1::jsonb) as r(id text, name text, description text, category text, category_ids jsonb, default_variation_id text, active boolean, visible boolean, updated_at timestamptz, created_at timestamptz)
       on conflict (square_item_id) do update set name = excluded.name, description = excluded.description, category = excluded.category,
         category_ids = excluded.category_ids, default_variation_id = excluded.default_variation_id, is_active = excluded.is_active,
         is_visible = excluded.is_visible, square_updated_at = excluded.square_updated_at, synced_at = now(),
         square_created_at = coalesce(public.catalog_products.square_created_at, excluded.square_created_at)`,
      [JSON.stringify(productRows)],
      tx,
    );
    if (variationRows.length) {
      await this.db.exec(
        `insert into public.catalog_variations (square_variation_id, square_item_id, name, sku, upc, price_cents, currency, is_sellable, square_updated_at, synced_at)
         select r.id, r.item_id, r.name, r.sku, r.upc, r.price, 'CAD', r.sellable, r.updated_at, now()
           from jsonb_to_recordset($1::jsonb) as r(id text, item_id text, name text, sku text, upc text, price integer, sellable boolean, updated_at timestamptz)
         on conflict (square_variation_id) do update set square_item_id = excluded.square_item_id, name = excluded.name, sku = excluded.sku, upc = excluded.upc,
           price_cents = excluded.price_cents, is_sellable = excluded.is_sellable, square_updated_at = excluded.square_updated_at, synced_at = now()`,
        [JSON.stringify(variationRows)],
        tx,
      );
    }
    // A variation Square no longer lists for an item can't be bought, but stays so old orders keep their reference.
    await this.db.exec(
      `update public.catalog_variations set is_sellable = false, synced_at = now()
        where square_item_id = any($1::text[]) and is_sellable and square_variation_id <> all($2::text[])`,
      [catalogItems.map((i) => i.id), variationRows.map((v) => v.id)],
      tx,
    );
    await this.db.exec(
      'delete from public.product_images where square_item_id = any($1::text[])',
      [catalogItems.map((i) => i.id)],
      tx,
    );
    if (imageRows.size) {
      await this.db.exec(
        `insert into public.product_images (square_item_id, square_image_id, image_url, sort_order)
         select r.item_id, r.image_id, r.url, r.sort
           from jsonb_to_recordset($1::jsonb) as r(item_id text, image_id text, url text, sort integer)
         on conflict (square_image_id) do update set square_item_id = excluded.square_item_id, image_url = excluded.image_url, sort_order = excluded.sort_order`,
        [JSON.stringify([...imageRows.values()])],
        tx,
      );
    }
    return { products: catalogItems.length, variations: variationRows.length };
  }

  private async syncInventory(tracked: string[], untracked: string[]) {
    const locationId = squareLocationId();
    if (!locationId || !(tracked.length + untracked.length)) return 0;
    let synced = 0;
    for (const ids of chunks(untracked)) {
      await this.writeInventory(
        ids.map((id) => ({ id, quantity: null })),
        new Date(),
      );
      synced += ids.length;
    }
    for (const ids of chunks(tracked)) {
      // Stamped with when we started reading, so a sale made while we read still counts as unreflected (see QuoteService.held).
      const readAt = new Date();
      const quantities = new Map<string, number>();
      let cursor: string | undefined;
      do {
        const data = await this.square.request('/v2/inventory/counts/batch-retrieve', {
          catalog_object_ids: ids,
          location_ids: [locationId],
          states: ['IN_STOCK'],
          ...(cursor ? { cursor } : {}),
        });
        for (const c of data.counts ?? [])
          quantities.set(
            c.catalog_object_id,
            (quantities.get(c.catalog_object_id) ?? 0) + Number(c.quantity ?? 0),
          );
        cursor = data.cursor;
      } while (cursor);
      await this.writeInventory(
        ids.map((id) => ({ id, quantity: Math.max(0, quantities.get(id) ?? 0) })),
        readAt,
      );
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
    inventoryEvents.changed(rows.filter((r) => r.quantity !== null).map((r) => r.id));
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
    const active = await this.db.many<Pick<CatalogProductRow, 'square_item_id'>>(
      "select square_item_id from public.catalog_products where source = 'square' and is_active",
    );
    const missing = active.map((r) => r.square_item_id).filter((id) => !seen.has(id));
    if (!missing.length) return 0;
    if (missing.length / active.length > retireMaxRatio()) {
      this.logger.warn(
        `Square sync would retire ${missing.length} of ${active.length} products (limit ${retireMaxRatio() * 100}%); skipped. Raise SQUARE_SYNC_RETIRE_MAX_RATIO if this is intentional.`,
      );
      return 0;
    }
    await this.db.exec(
      'update public.catalog_products set is_active = false, synced_at = now() where square_item_id = any($1::text[])',
      [missing],
    );
    this.logger.log(`Retired ${missing.length} product(s) deleted in Square.`);
    return missing.length;
  }
}
