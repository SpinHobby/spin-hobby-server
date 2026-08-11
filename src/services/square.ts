import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment, Currency, EcomVisibility } from "square";

// Category used to tag cashier-tool convention one-offs so they can be
// excluded from the public storefront (see searchCatalog). Override via env
// if this account's category ever changes; defaults to the one already
// created for this Square account so it works without extra setup.
const CASHIER_CATEGORY_ID =
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
  // other locations the merchant may have). Used by the cashier tool so
  // convention one-offs are searchable/chargeable in Square POS without
  // being scattered across every location.
  async createLocationItem(item: {
    name: string;
    description?: string;
    price: number; // smallest currency unit, e.g. cents
    photo?: { buffer: Buffer; mimetype: string };
  }) {
    const locationId = process.env.SQUARE_LOCATION_ID;

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
                  ecom_visibility: EcomVisibility.Hidden,
                  categories: CASHIER_CATEGORY_ID
                    ? [{ id: CASHIER_CATEGORY_ID }]
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
          imageFile: new Blob([new Uint8Array(item.photo.buffer)], {
            type: item.photo.mimetype,
          }),
        });
      } catch (error) {
        console.error("Error attaching photo to Square catalog item:", error);
      }
    }

    return createdItem;
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
}

export const squareService = new SquareService();
