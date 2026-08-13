import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment, Currency, EcomVisibility } from "square";
import { processProductPhoto } from "./imageProcessing";

// Category used to tag cashier-tool convention one-offs so they can be
// excluded from the public storefront (see searchCatalog). Override via env
// if this account's category ever changes; defaults to the one already
// created for this Square account so it works without extra setup.
export const CASHIER_CATEGORY_ID =
  process.env.SQUARE_CASHIER_CATEGORY_ID || "LNBIPZ6RYAMQTEZX3NF5VOGG";

export class SquareService {
  private client: SquareClient;

  constructor() {
    this.client = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment:
        process.env.SQUARE_ENVIRONMENT === "production"
          ? SquareEnvironment.Production
          : SquareEnvironment.Sandbox,
    });
  }

  // Search the catalog. Pass `keywords` to filter by item name/description, omit for the full catalog.
  // Items tagged with SQUARE_CASHIER_CATEGORY_ID (internal convention one-offs
  // created by the cashier tool) are excluded from storefront results - Square's
  // Search API has no server-side "exclude category" filter, so this is a
  // post-fetch filter.
  async searchCatalog(keywords?: string, cursor?: string, limit?: number) {
    const response = await this.client.catalog.search({
      objectTypes: ["ITEM"],
      includeRelatedObjects: true,
      cursor,
      limit,
      query: keywords ? { textQuery: { keywords: [keywords] } } : undefined,
    });

    const cashierCategoryId = CASHIER_CATEGORY_ID;
    const items = (response.objects || []).filter((obj: any) => {
      if (!cashierCategoryId) return true;
      const categories = obj.itemData?.categories || [];
      return !categories.some((c: any) => c.id === cashierCategoryId);
    });

    return {
      items,
      relatedObjects: response.relatedObjects || [],
      cursor: response.cursor,
    };
  }

  // Search by one or more real Square category IDs (optionally combined with
  // keywords), via the dedicated SearchCatalogItems endpoint - unlike the
  // generic catalog.search() used by searchCatalog() above, this one
  // actually supports server-side category filtering. Used to power the
  // storefront's curated display-category browsing (see categoryMapping.ts).
  // SearchCatalogItems doesn't return relatedObjects (images), so those are
  // fetched separately to keep the same {items, relatedObjects, cursor}
  // shape as searchCatalog().
  async searchByCategory(
    categoryIds: string[],
    keywords?: string,
    cursor?: string,
    limit?: number
  ) {
    const response = await this.client.catalog.searchItems({
      categoryIds,
      textFilter: keywords || undefined,
      cursor,
      limit,
    });

    const cashierCategoryId = CASHIER_CATEGORY_ID;
    const items = (response.items || []).filter((obj: any) => {
      if (!cashierCategoryId) return true;
      const categories = obj.itemData?.categories || [];
      return !categories.some((c: any) => c.id === cashierCategoryId);
    });

    const imageIds = new Set<string>();
    items.forEach((item: any) => {
      (item.itemData?.imageIds || []).forEach((id: string) => imageIds.add(id));
    });

    let relatedObjects: any[] = [];
    if (imageIds.size > 0) {
      const imageResponse = await this.client.catalog.batchGet({
        objectIds: Array.from(imageIds),
      });
      relatedObjects = imageResponse.objects || [];
    }

    return {
      items,
      relatedObjects,
      cursor: response.cursor,
    };
  }

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

  async listLocations() {
    const response = await this.client.locations.list();
    return response.locations || [];
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

  // Public-safe config the frontend needs to initialize the Web Payments SDK.
  getConfig() {
    return {
      applicationId: process.env.SQUARE_APPLICATION_ID,
      locationId: process.env.SQUARE_LOCATION_ID,
    };
  }

  // Create or update catalog items in bulk, e.g. for seeding test data.
  async upsertItems(
    items: {
      name: string;
      description?: string;
      price: number; // smallest currency unit, e.g. cents
      currency?: Currency;
    }[]
  ) {
    const response = await this.client.catalog.batchUpsert({
      idempotencyKey: randomUUID(),
      batches: [
        {
          objects: items.map((item, i) => ({
            type: "ITEM" as const,
            id: `#item-${i}`,
            itemData: {
              name: item.name,
              description: item.description,
              variations: [
                {
                  type: "ITEM_VARIATION" as const,
                  id: `#item-${i}-variation`,
                  itemVariationData: {
                    itemId: `#item-${i}`,
                    name: "Regular",
                    pricingType: "FIXED_PRICING" as const,
                    priceMoney: {
                      amount: BigInt(item.price),
                      currency: item.currency || Currency.Usd,
                    },
                  },
                },
              ],
            },
          })),
        },
      ],
    });

    return response.objects || [];
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
      process.env.SQUARE_ENVIRONMENT === "production"
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
        console.error("Error attaching photo to Square catalog item:", error);
      }
    }

    return createdItem;
  }

  // Updates an existing location-scoped item (name, description, price,
  // category, hidden/visible, optionally a new primary photo). Requires the
  // item's and variation's current `version` for Square's optimistic
  // concurrency check, so this always re-fetches the live item first rather
  // than trusting a stale version passed in from the caller.
  async updateLocationItem(update: {
    itemId: string;
    name: string;
    description?: string;
    price: number; // smallest currency unit, e.g. cents
    hidden: boolean;
    categoryId?: string;
    photo?: { buffer: Buffer; mimetype: string };
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

    const baseUrl =
      process.env.SQUARE_ENVIRONMENT === "production"
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
        console.error("Error attaching photo to Square catalog item:", error);
      }
    }

    return updatedItem;
  }

  // Charge a card using a payment token (nonce) produced by Square's Web Payments SDK on the frontend.
  async createPayment(params: {
    sourceId: string;
    amount: number; // in the smallest currency unit, e.g. cents
    currency?: Currency;
    locationId?: string;
    idempotencyKey?: string;
  }) {
    const response = await this.client.payments.create({
      sourceId: params.sourceId,
      idempotencyKey: params.idempotencyKey || randomUUID(),
      amountMoney: {
        amount: BigInt(params.amount),
        currency: params.currency || Currency.Cad,
      },
      locationId: params.locationId || process.env.SQUARE_LOCATION_ID,
    });

    return response.payment;
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

  // Records a web sale against Square's inventory as an IN_STOCK -> SOLD
  // adjustment (relative, not an absolute recount) so it doesn't race against
  // concurrent writers and shows up in Square's own reporting the same way
  // in-person POS sales already do.
  //
  // NOTE: SOLD_ONLINE looked like the right toState (would have let the
  // dashboard distinguish web sales from in-person ones) but Square's API
  // rejects IN_STOCK -> SOLD_ONLINE as an unsupported transition (confirmed
  // by actually calling it, not documented in the SDK's types) - SOLD_ONLINE
  // appears to be set internally by Square's own Online/eCommerce checkout,
  // not assignable via a third-party adjustment. Plain SOLD is the
  // supported transition for this.
  async recordSaleInventoryChanges(
    items: { variationId: string; quantity: number }[],
    idempotencyKey: string
  ): Promise<void> {
    if (items.length === 0) return;

    const locationId = process.env.SQUARE_LOCATION_ID;
    const occurredAt = new Date().toISOString();

    await this.client.inventory.batchCreateChanges({
      idempotencyKey,
      changes: items.map((item) => ({
        type: "ADJUSTMENT" as const,
        adjustment: {
          catalogObjectId: item.variationId,
          quantity: String(item.quantity),
          fromState: "IN_STOCK" as const,
          toState: "SOLD" as const,
          locationId,
          occurredAt,
        },
      })),
    });
  }
}

export const squareService = new SquareService();
