import { randomUUID } from "crypto";
import { SquareClient, SquareEnvironment, Currency } from "square";

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
  async searchCatalog(keywords?: string, cursor?: string, limit?: number) {
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
    const response = await this.client.catalog.batchUpsert({
      idempotencyKey: randomUUID(),
      batches: [
        {
          objects: [
            {
              type: "ITEM" as const,
              id: "#item",
              presentAtAllLocations: false,
              presentAtLocationIds: locationId ? [locationId] : undefined,
              itemData: {
                name: item.name,
                description: item.description,
                variations: [
                  {
                    type: "ITEM_VARIATION" as const,
                    id: "#item-variation",
                    presentAtAllLocations: false,
                    presentAtLocationIds: locationId ? [locationId] : undefined,
                    itemVariationData: {
                      itemId: "#item",
                      name: "Regular",
                      pricingType: "FIXED_PRICING" as const,
                      priceMoney: {
                        amount: BigInt(item.price),
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
    });

    const createdItem = response.objects?.[0] || null;

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
