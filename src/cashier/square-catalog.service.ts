import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Currency, EcomVisibility, SquareClient, SquareEnvironment } from "square";
import { env, squareEnvIsProduction } from "../config/env.js";
import { processProductPhoto } from "./image-processing.js";

// Ported from the legacy Express server (src/services/square.ts): only the methods the
// cashier tool uses. Behaviour is unchanged.

// Category used to tag cashier-tool convention one-offs so they can be
// excluded from the public storefront. Override via env if this account's
// category ever changes.
export const CASHIER_CATEGORY_ID = env("SQUARE_CASHIER_CATEGORY_ID") || "LNBIPZ6RYAMQTEZX3NF5VOGG";

@Injectable()
export class SquareCatalogService {
  private readonly logger = new Logger(SquareCatalogService.name);

  private warn(message: string, error?: unknown) {
    this.logger.warn(`${message} ${error instanceof Error ? error.message : (error ?? "")}`.trim());
  }

  private readonly client = new SquareClient({
    token: env("SQUARE_ACCESS_TOKEN"),
    environment: squareEnvIsProduction() ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  });

  // Unfiltered version of searchCatalog for internal/admin use (e.g. the
  // cashier tool's "Edit Existing" picker) - includes hidden convention
  // items, unlike the public storefront search.
  async searchAllItems(keywords?: string, cursor?: string, limit?: number) {
    const response = await this.client.catalog.search({
      objectTypes: ["ITEM"],
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
      objectTypes: ["CATEGORY"],
    });

    return response.objects || [];
  }

  // Finds an existing CATEGORY object by exact (case-insensitive) name, or
  // creates one. Used to keep cashier-assigned product categories (see
  // productCategories.ts) from creating duplicates on repeat calls.
  async getOrCreateCategoryId(name: string): Promise<string> {
    const existing = await this.listCategories();
    const match = existing.find(
      (c: any) => c.categoryData?.name?.toLowerCase() === name.toLowerCase()
    );
    if (match?.id) return match.id;

    const response = await this.client.catalog.batchUpsert({
      idempotencyKey: randomUUID(),
      batches: [
        {
          objects: [
            {
              type: "CATEGORY" as const,
              id: "#category",
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
  }) {
    const locationId = process.env.SQUARE_LOCATION_ID;
    const categories = [
      ...(item.categoryId ? [{ id: item.categoryId }] : []),
      ...(item.hidden && CASHIER_CATEGORY_ID ? [{ id: CASHIER_CATEGORY_ID }] : []),
    ];

    // The SDK's request serializer for catalog.batchUpsert doesn't know about
    // ecom_visibility yet (it's a real, documented Square API field - confirmed
    // present on read responses - but gets silently stripped on write through
    // the SDK). Call the REST endpoint directly for this one write instead.
    const baseUrl =
      squareEnvIsProduction()
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const upsertResponse = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify({
        idempotency_key: randomUUID(),
        batches: [
          {
            objects: [
              {
                type: "ITEM",
                id: "#item",
                present_at_all_locations: false,
                present_at_location_ids: locationId ? [locationId] : undefined,
                item_data: {
                  name: item.name,
                  description: item.description,
                  // Square ignores ecom_visibility on write for this account (new
                  // items auto-publish to Square Online regardless), and our own
                  // storefront doesn't consult it anyway - it queries the catalog
                  // directly. The real "hide from our website" signal is category
                  // membership, filtered out in searchCatalog() below.
                  ecom_visibility: item.hidden
                    ? EcomVisibility.Hidden
                    : EcomVisibility.Visible,
                  categories: categories.length > 0 ? categories : undefined,
                  reporting_category: item.categoryId
                    ? { id: item.categoryId }
                    : undefined,
                  variations: [
                    {
                      type: "ITEM_VARIATION",
                      id: "#item-variation",
                      present_at_all_locations: false,
                      present_at_location_ids: locationId ? [locationId] : undefined,
                      item_variation_data: {
                        item_id: "#item",
                        name: "Regular",
                        pricing_type: "FIXED_PRICING",
                        price_money: {
                          amount: item.price,
                          currency: Currency.Cad,
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    const upsertData: any = await upsertResponse.json();
    if (!upsertResponse.ok) {
      throw new Error(
        upsertData?.errors?.[0]?.detail || "Failed to create Square catalog item"
      );
    }

    const createdItem = upsertData.objects?.[0] || null;

    if (createdItem?.id && item.photo) {
      try {
        const processedPhoto = await processProductPhoto(item.photo.buffer);
        await this.client.catalog.images.create({
          request: {
            idempotencyKey: randomUUID(),
            objectId: createdItem.id,
            isPrimary: true,
            image: {
              type: "IMAGE" as const,
              id: "#image",
              imageData: { name: item.name },
            },
          },
          imageFile: new Blob([new Uint8Array(processedPhoto)], {
            type: "image/jpeg",
          }),
        });
      } catch (error) {
        this.warn("Error attaching photo to Square catalog item:", error);
      }
    }

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
    if (!existing || existing.type !== "ITEM") {
      throw new Error(`Item ${update.itemId} not found`);
    }
    const variation = existing.itemData?.variations?.[0];
    if (!variation || variation.type !== "ITEM_VARIATION") {
      throw new Error(`Item ${update.itemId} has no variation to update`);
    }

    const categories = [
      ...(update.categoryId ? [{ id: update.categoryId }] : []),
      ...(update.hidden && CASHIER_CATEGORY_ID ? [{ id: CASHIER_CATEGORY_ID }] : []),
    ];

    // Square's catalog upsert fully replaces item_data - any field left out
    // of the request body (not just left `undefined` in JS) resets to
    // empty, image_ids included. So existing photos must be explicitly
    // re-sent to survive an edit that isn't touching the photo at all;
    // an empty array here explicitly clears them (removePhoto, or about to
    // attach a replacement below).
    const imageIds =
      update.removePhoto || update.photo ? [] : existing.itemData?.imageIds || [];

    const baseUrl =
      squareEnvIsProduction()
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const upsertResponse = await fetch(`${baseUrl}/v2/catalog/batch-upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify({
        idempotency_key: randomUUID(),
        batches: [
          {
            objects: [
              {
                type: "ITEM",
                id: existing.id,
                version: existing.version != null ? Number(existing.version) : undefined,
                item_data: {
                  name: update.name,
                  description: update.description,
                  ecom_visibility: update.hidden
                    ? EcomVisibility.Hidden
                    : EcomVisibility.Visible,
                  categories: categories.length > 0 ? categories : undefined,
                  reporting_category: update.categoryId
                    ? { id: update.categoryId }
                    : undefined,
                  image_ids: imageIds,
                  variations: [
                    {
                      type: "ITEM_VARIATION",
                      id: variation.id,
                      version: variation.version != null ? Number(variation.version) : undefined,
                      item_variation_data: {
                        item_id: existing.id,
                        name: "Regular",
                        pricing_type: "FIXED_PRICING",
                        price_money: {
                          amount: update.price,
                          currency: Currency.Cad,
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });

    const upsertData: any = await upsertResponse.json();
    if (!upsertResponse.ok) {
      throw new Error(
        upsertData?.errors?.[0]?.detail || "Failed to update Square catalog item"
      );
    }

    const updatedItem = upsertData.objects?.[0] || null;

    if (updatedItem?.id && update.photo) {
      try {
        const processedPhoto = await processProductPhoto(update.photo.buffer);
        await this.client.catalog.images.create({
          request: {
            idempotencyKey: randomUUID(),
            objectId: updatedItem.id,
            isPrimary: true,
            image: {
              type: "IMAGE" as const,
              id: "#image",
              imageData: { name: update.name },
            },
          },
          imageFile: new Blob([new Uint8Array(processedPhoto)], {
            type: "image/jpeg",
          }),
        });
      } catch (error) {
        this.warn("Error attaching photo to Square catalog item:", error);
      }
    }

    return updatedItem;
  }

  // Current tracked counts for the given item VARIATION ids at this location.
  // A variation missing from the returned map is untracked in Square - treat
  // that as unlimited stock, not zero.
  async getInventoryCounts(
    variationIds: string[]
  ): Promise<Record<string, number>> {
    if (variationIds.length === 0) return {};

    const locationId = process.env.SQUARE_LOCATION_ID;
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
  async setInitialInventoryCount(
    variationId: string,
    quantity: number
  ): Promise<void> {
    const locationId = process.env.SQUARE_LOCATION_ID;

    await this.client.inventory.batchCreateChanges({
      idempotencyKey: randomUUID(),
      changes: [
        {
          type: "PHYSICAL_COUNT" as const,
          physicalCount: {
            catalogObjectId: variationId,
            state: "IN_STOCK" as const,
            locationId,
            quantity: String(quantity),
            occurredAt: new Date().toISOString(),
          },
        },
      ],
    });
  }
}
