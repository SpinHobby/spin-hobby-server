import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Currency, EcomVisibility, SquareClient as SquareSdk, SquareEnvironment } from 'square';
import { processProductPhoto } from '../../modules/cashier/image-processing.js';
import {
  CASHIER_CATEGORY_ID,
  SQUARE_CATALOG_API_VERSION,
  squareAccessToken,
  squareBaseUrl,
  squareIsProduction,
  squareLocationId,
} from '../../config/square.config.js';
import type { ExternalJson } from '../../common/external-json.js';
import { isHiddenInSquareItself } from './visibility.js';
import { AppError, errorText } from '../../common/errors.js';

/**
 * Square catalog calls for the cashier tool: searching items, creating and editing them, and stock counts.
 * (Checkout, refunds and the catalog sync use `SquareHttpClient` instead.)
 *
 * Most calls go through the official SDK. Creating and editing an item are the exception: they call the REST
 * endpoint directly (see `batchUpsert`), because the SDK silently drops a field we need to send.
 */
@Injectable()
export class SquareCatalogClient {
  private readonly logger = new Logger(SquareCatalogClient.name);

  private warn(message: string, error?: unknown) {
    this.logger.warn(`${message} ${error === undefined ? '' : errorText(error)}`.trim());
  }

  private readonly client = new SquareSdk({
    token: squareAccessToken(),
    environment: squareIsProduction() ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  });

  // Unfiltered version of searchCatalog for internal/admin use (e.g. the
  // cashier tool's "Edit Existing" picker) - includes hidden convention
  // items, unlike the public storefront search.
  async searchAllItems(keywords?: string, cursor?: string, limit?: number) {
    const response = await this.client.catalog.search({
      objectTypes: ['ITEM'],
      includeRelatedObjects: true,
      cursor,
      limit,
      query: keywords ? { textQuery: { keywords: [keywords] } } : undefined,
    });

    return {
      items: response.objects || [],
      relatedObjects: response.relatedObjects || [],
      cursor: response.cursor,
    };
  }

  async getItem(id: string) {
    const response = await this.client.catalog.batchGet({
      objectIds: [id],
      includeRelatedObjects: true,
    });

    return {
      item: response.objects?.[0] || null,
      relatedObjects: response.relatedObjects || [],
    };
  }

  async listCategories() {
    const response = await this.client.catalog.search({
      objectTypes: ['CATEGORY'],
    });

    return response.objects || [];
  }

  // Finds an existing CATEGORY object by exact (case-insensitive) name, or
  // creates one. Used to keep cashier-assigned product categories (see
  // productCategories.ts) from creating duplicates on repeat calls.
  async getOrCreateCategoryId(name: string): Promise<string> {
    const existing = await this.listCategories();
    const match = existing.find(
      (c) =>
        (c as { categoryData?: { name?: string } }).categoryData?.name?.toLowerCase() ===
        name.toLowerCase(),
    );
    if (match?.id) return match.id;

    const response = await this.client.catalog.batchUpsert({
      idempotencyKey: randomUUID(),
      batches: [
        {
          objects: [
            {
              type: 'CATEGORY' as const,
              id: '#category',
              categoryData: { name },
            },
          ],
        },
      ],
    });

    const created = response.objects?.[0];
    if (!created?.id) {
      throw new Error(`Failed to create category "${name}"`);
    }
    return created.id;
  }

  /** The categories an item belongs to: the shop category, plus the "not for the website" marker when hidden. */
  private categoriesFor(categoryId: string | undefined, hidden: boolean) {
    return [
      ...(categoryId ? [{ id: categoryId }] : []),
      ...(hidden && CASHIER_CATEGORY_ID ? [{ id: CASHIER_CATEGORY_ID }] : []),
    ];
  }

  /**
   * Creates or replaces one catalog ITEM through Square's REST endpoint and returns the saved object.
   * The SDK's request serializer for catalog.batchUpsert doesn't know about `ecom_visibility` yet (a real,
   * documented Square field that is present on read responses but silently stripped on write through the
   * SDK), so this one write is made directly. `failureMessage` is used when Square gives no reason.
   */
  /** Headers for the direct REST calls (the same pinned API version for every catalog write). */
  private restHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${squareAccessToken()}`,
      'Square-Version': SQUARE_CATALOG_API_VERSION,
    };
  }

  /** One catalog object exactly as Square stores it (every field, in Square's own JSON shape), or null. */
  private async retrieveObject(id: string): Promise<ExternalJson | null> {
    const response = await fetch(`${squareBaseUrl()}/v2/catalog/batch-retrieve`, {
      method: 'POST',
      headers: this.restHeaders(),
      body: JSON.stringify({ object_ids: [id] }),
    });
    const data: ExternalJson = await response.json();
    if (!response.ok)
      throw new Error(data?.errors?.[0]?.detail || 'Failed to read the item from Square');
    return data.objects?.[0] || null;
  }

  private async batchUpsert(object: Record<string, unknown>, failureMessage: string) {
    const response = await fetch(`${squareBaseUrl()}/v2/catalog/batch-upsert`, {
      method: 'POST',
      headers: this.restHeaders(),
      body: JSON.stringify({ idempotency_key: randomUUID(), batches: [{ objects: [object] }] }),
    });
    const data: ExternalJson = await response.json();
    if (!response.ok) throw new Error(data?.errors?.[0]?.detail || failureMessage);
    return data.objects?.[0] || null;
  }

  /**
   * Removes an item from Square together with its variations and the photos attached to it. Used to undo a
   * product that was created by mistake (a failed move). An item that is already gone counts as done.
   */
  async deleteItem(itemId: string): Promise<void> {
    const object = await this.retrieveObject(itemId);
    if (!object) return;
    const imageIds: string[] = object.item_data?.image_ids ?? [];
    const response = await fetch(`${squareBaseUrl()}/v2/catalog/batch-delete`, {
      method: 'POST',
      headers: this.restHeaders(),
      body: JSON.stringify({ object_ids: [itemId, ...imageIds] }),
    });
    const data: ExternalJson = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data?.errors?.[0]?.detail || 'Failed to delete the item from Square');
  }

  /** Makes `photo` the item's primary picture. A failure is logged, never thrown: the item itself is already saved. */
  private async attachPhoto(itemId: string, name: string, photo: Buffer, isPrimary = true) {
    try {
      const processedPhoto = await processProductPhoto(photo);
      await this.client.catalog.images.create({
        request: {
          idempotencyKey: randomUUID(),
          objectId: itemId,
          isPrimary,
          image: { type: 'IMAGE' as const, id: '#image', imageData: { name } },
        },
        imageFile: new Blob([new Uint8Array(processedPhoto)], { type: 'image/jpeg' }),
      });
      return true;
    } catch (error) {
      this.warn('Error attaching photo to Square catalog item:', error);
      return false;
    }
  }

  /**
   * Adds photos to an item (converted to JPEG; the first becomes the main picture).
   * Returns how many were saved, so a caller that deletes its own copies can check they all arrived.
   */
  async attachPhotos(itemId: string, name: string, photos: Buffer[]): Promise<number> {
    let saved = 0;
    for (const [index, photo] of photos.entries()) {
      if (await this.attachPhoto(itemId, name, photo, index === 0)) saved += 1;
    }
    return saved;
  }

  /**
   * Hides an item from (or shows it on) the website by adding or removing the "hidden from the website" category
   * in Square (CASHIER_CATEGORY_ID). The item is read from Square and saved back with only its categories
   * changed, so its variations, photos, taxes and every other setting stay exactly as they were.
   * Returns the item's category ids afterwards.
   */
  async setItemHidden(itemId: string, hidden: boolean): Promise<string[]> {
    const existing = await this.retrieveObject(itemId);
    if (!existing || existing.type !== 'ITEM' || !existing.item_data)
      throw new AppError('This item was not found in Square.', 404);
    // Square's own settings (online visibility, location availability) cannot be changed through the API
    // for this account, so say so rather than appear to show an item that would stay hidden.
    if (!hidden && isHiddenInSquareItself(existing))
      throw new AppError(
        'This product is hidden in Square itself (its online visibility or location availability). Show it in the Square Dashboard, then try again.',
        409,
      );
    const categories = ((existing.item_data.categories ?? []) as { id: string }[]).filter(Boolean);
    const marked = categories.some((c) => c.id === CASHIER_CATEGORY_ID);
    if (marked === hidden) return categories.map((c) => c.id); // already in the wanted state: no write
    const next = hidden
      ? [...categories, { id: CASHIER_CATEGORY_ID }]
      : categories.filter((c) => c.id !== CASHIER_CATEGORY_ID);
    const { updated_at: _updatedAt, created_at: _createdAt, ...writable } = existing; // read-only in Square
    const saved = await this.batchUpsert(
      { ...writable, item_data: { ...existing.item_data, categories: next } },
      'Failed to update the item in Square',
    );
    return ((saved?.item_data?.categories ?? next) as { id: string }[]).map((c) => c.id);
  }

  // Create a single catalog item scoped to this location only (not present at
  // other locations the merchant may have). Used by the cashier tool for two
  // workflows: convention one-offs (hidden from the storefront, chargeable in
  // Square POS) and website inventory entries (visible, stock-tracked).
  async createLocationItem(item: {
    name: string;
    description?: string;
    price: number; // smallest currency unit, e.g. cents
    photo?: { buffer: Buffer; mimetype: string };
    hidden: boolean;
    categoryId?: string;
    /** Barcode (UPC / EAN / JAN), digits only; Square's POS scans it. */
    upc?: string;
  }) {
    const locationId = squareLocationId();
    const categories = this.categoriesFor(item.categoryId, item.hidden);

    const createdItem = await this.batchUpsert(
      {
        type: 'ITEM',
        id: '#item',
        present_at_all_locations: false,
        present_at_location_ids: locationId ? [locationId] : undefined,
        item_data: {
          name: item.name,
          description: item.description,
          // Square ignores ecom_visibility on write for this account (new
          // items auto-publish to Square Online regardless), and our own
          // storefront doesn't consult it anyway - it queries the catalog
          // directly. The real "hide from our website" signal is category
          // membership (see CASHIER_CATEGORY_ID).
          ecom_visibility: item.hidden ? EcomVisibility.Hidden : EcomVisibility.Visible,
          categories: categories.length > 0 ? categories : undefined,
          reporting_category: item.categoryId ? { id: item.categoryId } : undefined,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#item-variation',
              present_at_all_locations: false,
              present_at_location_ids: locationId ? [locationId] : undefined,
              item_variation_data: {
                item_id: '#item',
                name: 'Regular',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: item.price, currency: Currency.Cad },
                ...(item.upc ? { upc: item.upc } : {}),
              },
            },
          ],
        },
      },
      'Failed to create Square catalog item',
    );

    if (createdItem?.id && item.photo)
      await this.attachPhoto(createdItem.id, item.name, item.photo.buffer);

    return createdItem;
  }

  // Updates an existing location-scoped item (name, description, price,
  // category, hidden/visible, optionally a new primary photo or removing
  // the current one). Requires the item's and variation's current
  // `version` for Square's optimistic concurrency check, so this always
  // re-fetches the live item first rather than trusting a stale version
  // passed in from the caller.
  async updateLocationItem(update: {
    itemId: string;
    name: string;
    description?: string;
    price: number; // smallest currency unit, e.g. cents
    hidden: boolean;
    categoryId?: string;
    photo?: { buffer: Buffer; mimetype: string };
    removePhoto?: boolean;
  }) {
    const { item: existing } = await this.getItem(update.itemId);
    if (!existing || existing.type !== 'ITEM') {
      throw new Error(`Item ${update.itemId} not found`);
    }
    const variation = existing.itemData?.variations?.[0];
    if (!variation || variation.type !== 'ITEM_VARIATION') {
      throw new Error(`Item ${update.itemId} has no variation to update`);
    }

    const categories = this.categoriesFor(update.categoryId, update.hidden);

    // Square's catalog upsert fully replaces item_data - any field left out
    // of the request body (not just left `undefined` in JS) resets to
    // empty, image_ids included. So existing photos must be explicitly
    // re-sent to survive an edit that isn't touching the photo at all;
    // an empty array here explicitly clears them (removePhoto, or about to
    // attach a replacement below).
    const imageIds = update.removePhoto || update.photo ? [] : existing.itemData?.imageIds || [];

    const updatedItem = await this.batchUpsert(
      {
        type: 'ITEM',
        id: existing.id,
        version: existing.version != null ? Number(existing.version) : undefined,
        item_data: {
          name: update.name,
          description: update.description,
          ecom_visibility: update.hidden ? EcomVisibility.Hidden : EcomVisibility.Visible,
          categories: categories.length > 0 ? categories : undefined,
          reporting_category: update.categoryId ? { id: update.categoryId } : undefined,
          image_ids: imageIds,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: variation.id,
              version: variation.version != null ? Number(variation.version) : undefined,
              item_variation_data: {
                item_id: existing.id,
                name: 'Regular',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: update.price, currency: Currency.Cad },
              },
            },
          ],
        },
      },
      'Failed to update Square catalog item',
    );

    if (updatedItem?.id && update.photo)
      await this.attachPhoto(updatedItem.id, update.name, update.photo.buffer);

    return updatedItem;
  }

  // Current tracked counts for the given item VARIATION ids at this location.
  // A variation missing from the returned map is untracked in Square - treat
  // that as unlimited stock, not zero.
  async getInventoryCounts(variationIds: string[]): Promise<Record<string, number>> {
    if (variationIds.length === 0) return {};

    const locationId = squareLocationId();
    const page = await this.client.inventory.batchGetCounts({
      catalogObjectIds: variationIds,
      locationIds: locationId ? [locationId] : undefined,
    });

    const counts: Record<string, number> = {};
    for await (const count of page) {
      if (count.catalogObjectId && count.quantity != null) {
        counts[count.catalogObjectId] = Number(count.quantity);
      }
    }
    return counts;
  }

  // Sets the starting stock count for a freshly-created variation. This is a
  // PHYSICAL_COUNT (an absolute snapshot), not an ADJUSTMENT, since there's
  // no prior state to transition from - the cashier tool is the one entering
  // the real-world count for the first time.
  async setInitialInventoryCount(variationId: string, quantity: number): Promise<void> {
    const locationId = squareLocationId();

    await this.client.inventory.batchCreateChanges({
      idempotencyKey: randomUUID(),
      changes: [
        {
          type: 'PHYSICAL_COUNT' as const,
          physicalCount: {
            catalogObjectId: variationId,
            state: 'IN_STOCK' as const,
            locationId,
            quantity: String(quantity),
            occurredAt: new Date().toISOString(),
          },
        },
      ],
    });
  }
}
