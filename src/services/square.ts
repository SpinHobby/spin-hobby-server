import { SquareClient } from "square";
import { config } from "dotenv";
import SquareMerchant from "../db/models/squareMerchant";

config();

export class SquareService {
  private client: SquareClient;
  private applicationId: string;
  private environment: string;

  constructor() {
    this.applicationId = process.env.SQUARE_APPLICATION_ID || "";
    this.environment =
      process.env.NODE_ENV === "production" ? "production" : "sandbox";

    // Initialize Square client
    this.client = new SquareClient({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: this.environment === "production" ? "production" : "sandbox",
    });
  }

  /**
   * 1. PRODUCT DATA RETRIEVAL
   */

  // Get all products from Square catalog
  async getProducts(cursor?: string) {
    try {
      const response = await this.client.catalog.list({
        cursor,
        types: ["ITEM"],
        includeDeletedObjects: false,
      });

      const products =
        response.objects?.map((obj: any) => this.formatSquareProduct(obj)) ||
        [];

      return {
        products,
        cursor: response.cursor,
        hasMore: !!response.cursor,
      };
    } catch (error) {
      console.error("Error fetching products from Square:", error);
      throw new Error("Failed to fetch products from Square");
    }
  }

  // Get a specific product by Square ID
  async getProductById(catalogObjectId: string) {
    try {
      const response = await this.client.catalog.get({
        objectId: catalogObjectId,
        includeRelatedObjects: true,
      });

      if (!response.object) {
        throw new Error("Product not found");
      }

      return this.formatSquareProduct(response.object);
    } catch (error) {
      console.error(`Error fetching product ${catalogObjectId}:`, error);
      throw new Error("Failed to fetch product from Square");
    }
  }

  // Search products by name or category
  async searchProducts(query: string, categoryIds?: string[]) {
    try {
      const searchRequest: any = {
        objectTypes: ["ITEM"],
        query: {
          textQuery: {
            filter: {
              textFilter: query,
            },
          },
        },
      };

      if (categoryIds && categoryIds.length > 0) {
        searchRequest.query.exactQuery = {
          attributeName: "category_id",
          attributeValue: categoryIds[0], // Square typically uses single category
        };
      }

      const response = await this.client.catalog.search(searchRequest);

      const products =
        response.objects?.map((obj: any) => this.formatSquareProduct(obj)) ||
        [];

      return products;
    } catch (error) {
      console.error("Error searching products in Square:", error);
      throw new Error("Failed to search products in Square");
    }
  }

  // Get Square categories
  async getCategories() {
    try {
      const response = await this.client.catalog.list({
        types: ["CATEGORY"],
        includeDeletedObjects: false,
      });

      return (
        response.objects?.map((obj: any) => this.formatSquareCategory(obj)) ||
        []
      );
    } catch (error) {
      console.error("Error fetching categories from Square:", error);
      throw new Error("Failed to fetch categories from Square");
    }
  }

  /**
   * 2. SQUARE AUTHENTICATION & LOGIN
   */

  // Generate OAuth authorization URL for Square login
  getOAuthUrl(redirectUri: string, state?: string) {
    const baseUrl =
      this.environment === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const params = new URLSearchParams({
      client_id: this.applicationId,
      scope: "MERCHANT_PROFILE_READ ITEMS_READ PAYMENTS_READ",
      response_type: "code",
      redirect_uri: redirectUri,
      state: state || "default",
    });

    return `${baseUrl}/oauth2/authorize?${params.toString()}`;
  }

  // Exchange authorization code for access token
  async exchangeCodeForToken(authorizationCode: string, redirectUri: string) {
    try {
      const response = await this.client.oAuthApi.obtainToken({
        clientId: this.applicationId,
        clientSecret: process.env.SQUARE_APPLICATION_SECRET!,
        code: authorizationCode,
        redirectUri: redirectUri,
        grantType: "authorization_code",
      });

      const result = response.result;

      if (result.accessToken) {
        // Get merchant info with the new token
        const merchantInfo = await this.getMerchantInfo(result.accessToken);

        // Store in database
        const merchantData = {
          merchantId: result.merchantId || merchantInfo?.id || "unknown",
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenExpiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
          merchantName: merchantInfo?.businessName || "Unknown Business",
          businessName: merchantInfo?.businessName || "Unknown Business",
          status: "active" as const,
        };

        const merchant = await SquareMerchant.createOrUpdateFromOAuth(
          merchantData
        );

        return {
          success: true,
          merchant,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
          merchantId: result.merchantId,
        };
      } else {
        throw new Error("No access token received from Square");
      }
    } catch (error: any) {
      console.error("Error exchanging code for token:", error);
      throw new Error(`Failed to authenticate with Square: ${error.message}`);
    }
  }

  // Get merchant information
  async getMerchantInfo(accessToken?: string) {
    try {
      const client = accessToken
        ? new SquareClient({
            accessToken,
            environment:
              this.environment === "production" ? "production" : "sandbox",
          })
        : this.client;

      const response = await client.merchantsApi.listMerchants();
      const merchants = response.result.merchant;

      if (merchants && merchants.length > 0) {
        const merchant = merchants[0];
        return {
          id: merchant.id || "",
          businessName: merchant.businessName || "Unknown Business",
          country: merchant.country || "US",
          languageCode: merchant.languageCode || "en-US",
          currency: merchant.currency || "USD",
          status: merchant.status || "ACTIVE",
        };
      } else {
        throw new Error("No merchant found");
      }
    } catch (error: any) {
      console.error("Error fetching merchant info:", error);
      throw new Error(`Failed to fetch merchant information: ${error.message}`);
    }
  }

  /**
   * 3. PAYMENT PROCESSING (FOR CUSTOMERS)
   */

  // Create payment (customer checkout)
  async createPayment(paymentRequest: any) {
    try {
      const response = await this.client.paymentsApi.createPayment(
        paymentRequest
      );

      return {
        success: true,
        payment: response.result.payment,
      };
    } catch (error: any) {
      console.error("Error creating payment:", error);

      // Handle Square API errors gracefully
      const errorMessage =
        error.result?.errors?.[0]?.detail || error.message || "Payment failed";

      return {
        success: false,
        error: errorMessage,
        details: error.result?.errors || [],
      };
    }
  }

  // Create refund
  async createRefund(refundRequest: any) {
    try {
      const response = await this.client.refundsApi.refundPayment(
        refundRequest
      );

      return {
        success: true,
        refund: response.result.refund,
      };
    } catch (error: any) {
      console.error("Error creating refund:", error);

      const errorMessage =
        error.result?.errors?.[0]?.detail || error.message || "Refund failed";

      return {
        success: false,
        error: errorMessage,
        details: error.result?.errors || [],
      };
    }
  }

  // Get payment details
  async getPayment(paymentId: string) {
    try {
      const response = await this.client.paymentsApi.getPayment({
        paymentId,
      });

      return response.result.payment;
    } catch (error: any) {
      console.error(`Error fetching payment ${paymentId}:`, error);
      throw new Error(`Failed to fetch payment: ${error.message}`);
    }
  }

  // Create hosted checkout session (redirect to Square website)
  async createCheckoutSession(checkoutRequest: any) {
    try {
      const response = await this.client.checkoutApi.createPaymentLink(
        checkoutRequest
      );

      return {
        success: true,
        checkout_url: response.result.paymentLink?.url,
        checkout_id: response.result.paymentLink?.id,
        order_id: response.result.paymentLink?.orderId,
        payment_link: response.result.paymentLink,
      };
    } catch (error: any) {
      console.error("Error creating checkout session:", error);

      const errorMessage =
        error.result?.errors?.[0]?.detail ||
        error.message ||
        "Checkout creation failed";

      return {
        success: false,
        error: errorMessage,
        details: error.result?.errors || [],
      };
    }
  }

  // Get product by ID from Square catalog
  async getProductById(productId: string) {
    try {
      const response = await this.client.catalogApi.retrieveCatalogObject({
        objectId: productId,
        includeRelatedObjects: true,
      });

      const catalogObject = response.result.object;

      if (catalogObject?.type === "ITEM") {
        const itemData = catalogObject.itemData;
        const variations = itemData?.variations || [];

        // Get the first variation for pricing
        const firstVariation = variations[0];
        const price = firstVariation?.itemVariationData?.priceMoney?.amount
          ? Number(firstVariation.itemVariationData.priceMoney.amount) / 100
          : 0;

        return {
          id: catalogObject.id,
          name: itemData?.name || "",
          description: itemData?.description || "",
          price: price,
          image_url: itemData?.imageUrl || "",
          variations: variations.map((v: any) => ({
            id: v.id,
            name: v.itemVariationData?.name || "",
            price: v.itemVariationData?.priceMoney?.amount
              ? Number(v.itemVariationData.priceMoney.amount) / 100
              : 0,
          })),
        };
      }

      return null;
    } catch (error: any) {
      console.error(`Error fetching product ${productId}:`, error);
      throw new Error(`Failed to fetch product: ${error.message}`);
    }
  }

  /**
   * 4. MESSAGING & WEBHOOKS
   */

  // Verify Square webhook signature
  verifyWebhookSignature(body: string, signature: string): boolean {
    try {
      const crypto = require("crypto");
      const webhookSignatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

      if (!webhookSignatureKey) {
        console.error("Square webhook signature key not configured");
        return false;
      }

      const hash = crypto
        .createHmac("sha1", webhookSignatureKey)
        .update(body)
        .digest("base64");

      return hash === signature;
    } catch (error) {
      console.error("Error verifying webhook signature:", error);
      return false;
    }
  }

  // Process webhook events
  async processWebhookEvent(eventType: string, eventData: any) {
    try {
      switch (eventType) {
        case "catalog.version.updated":
          console.log("Catalog updated, syncing products...");
          await this.syncProductsFromSquare();
          break;

        case "inventory.count.updated":
          console.log("Inventory updated:", eventData);
          await this.syncInventoryFromSquare(eventData);
          break;

        case "payment.created":
          console.log("Payment created:", eventData);
          await this.handlePaymentCreated(eventData);
          break;

        default:
          console.log(`Unhandled webhook event: ${eventType}`);
      }
    } catch (error) {
      console.error(`Error processing webhook event ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * UTILITY METHODS
   */

  // Format Square product for our database
  private formatSquareProduct(squareProduct: any) {
    const itemData = squareProduct.itemData;

    return {
      squareId: squareProduct.id,
      name: itemData?.name || "",
      description: itemData?.description || "",
      categoryId: itemData?.categoryId,
      variations:
        itemData?.variations?.map((variation: any) => ({
          id: variation.id,
          name: variation.itemVariationData?.name || "",
          price: variation.itemVariationData?.priceMoney?.amount || 0,
          currency: variation.itemVariationData?.priceMoney?.currency || "USD",
          sku: variation.itemVariationData?.sku || "",
        })) || [],
      images: squareProduct.imageData
        ? [
            {
              id: squareProduct.imageData.id,
              url: squareProduct.imageData.url,
              caption: squareProduct.imageData.caption,
            },
          ]
        : [],
      isDeleted: squareProduct.isDeleted || false,
      updatedAt: new Date(squareProduct.updatedAt),
      version: squareProduct.version,
    };
  }

  // Format Square category for our database
  private formatSquareCategory(squareCategory: any) {
    return {
      squareId: squareCategory.id,
      name: squareCategory.categoryData?.name || "",
      parentCategoryId: squareCategory.categoryData?.parentCategory?.id,
      isDeleted: squareCategory.isDeleted || false,
      updatedAt: new Date(squareCategory.updatedAt),
      version: squareCategory.version,
    };
  }

  // Sync all products from Square to local database
  private async syncProductsFromSquare() {
    try {
      let cursor: string | undefined;
      let totalSynced = 0;

      do {
        const result = await this.getProducts(cursor);

        // Here you would save products to your database
        // This is where you'd integrate with your Sequelize models
        console.log(`Synced ${result.products.length} products from Square`);

        totalSynced += result.products.length;
        cursor = result.cursor;
      } while (cursor);

      console.log(`Total products synced: ${totalSynced}`);
    } catch (error) {
      console.error("Error syncing products from Square:", error);
      throw error;
    }
  }

  // Sync inventory from Square
  private async syncInventoryFromSquare(eventData: any) {
    // Implementation for inventory sync
    console.log("Syncing inventory from Square...", eventData);
  }

  // Handle payment created webhook
  private async handlePaymentCreated(eventData: any) {
    // Implementation for payment handling
    console.log("Handling payment created...", eventData);
  }
}

// Export singleton instance
export const squareService = new SquareService();
