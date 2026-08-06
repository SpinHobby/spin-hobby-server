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
  async searchCatalog(keywords?: string, cursor?: string) {
    const response = await this.client.catalog.search({
      objectTypes: ["ITEM"],
      includeRelatedObjects: true,
      cursor,
      query: keywords ? { textQuery: { keywords: [keywords] } } : undefined,
    });

    return {
      items: response.objects || [],
      relatedObjects: response.relatedObjects || [],
      cursor: response.cursor,
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
        currency: params.currency || Currency.Usd,
      },
      locationId: params.locationId || process.env.SQUARE_LOCATION_ID,
    });

    return response.payment;
  }
}

export const squareService = new SquareService();
