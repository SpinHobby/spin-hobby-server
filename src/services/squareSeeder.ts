import { squareService } from "./square";
import {
  SquareProduct,
  SquareCategory,
  SquareMerchant,
  SquareSyncStatus,
} from "../db/models/initModels";
import { Op } from "sequelize";
import {
  animeCategoriesSeeds,
  animeProductSeeds,
  AnimeProductSeed,
  AnimeCategorySeed,
} from "../data/animeInventorySeeds";

export class SquareSeederService {
  /**
   * MAIN SEEDING METHODS
   */

  // Complete Square data seeding
  async seedAll() {
    console.log("🌱 Starting complete Square data seeding...");

    const syncStatus = await SquareSyncStatus.startSync("full");

    try {
      // Step 1: Seed categories first (products depend on categories)
      const categoriesResult = await this.seedCategories();

      // Step 2: Seed products
      const productsResult = await this.seedProducts();

      // Step 3: Create default featured items for admin
      await this.createDefaultFeaturedItems();

      await syncStatus.completeSync(true);

      console.log("🎉 Complete seeding finished successfully!");

      return {
        success: true,
        categories: categoriesResult,
        products: productsResult,
        message: "Square data seeded successfully with admin controls ready",
      };
    } catch (error: any) {
      await syncStatus.completeSync(false, error.message);
      console.error("❌ Seeding failed:", error);
      throw error;
    }
  }

  // Seed Square categories
  async seedCategories() {
    console.log("📂 Seeding Square categories...");

    const syncStatus = await SquareSyncStatus.startSync("categories");

    try {
      const squareCategories = await squareService.getCategories();

      let processed = 0;
      let created = 0;
      let updated = 0;

      for (const squareCat of squareCategories) {
        const [category, wasCreated] = await SquareCategory.syncFromSquare(
          squareCat
        );

        if (wasCreated) {
          created++;
        } else {
          updated++;
        }

        processed++;
        await syncStatus.updateProgress(processed, {
          created,
          updated,
          currentCategory: squareCat.name,
        });
      }

      await syncStatus.completeSync(true);

      console.log(
        `✅ Categories seeded: ${created} created, ${updated} updated`
      );

      return { total: processed, created, updated };
    } catch (error: any) {
      await syncStatus.completeSync(false, error.message);
      throw error;
    }
  }

  // Seed Square products
  async seedProducts() {
    console.log("📦 Seeding Square products...");

    const syncStatus = await SquareSyncStatus.startSync("products");

    try {
      let cursor: string | undefined;
      let processed = 0;
      let created = 0;
      let updated = 0;

      do {
        const result = await squareService.getProducts(cursor);

        for (const squareProduct of result.products) {
          const [product, wasCreated] = await SquareProduct.syncFromSquare(
            squareProduct
          );

          if (wasCreated) {
            created++;
          } else {
            updated++;
          }

          processed++;
          await syncStatus.updateProgress(processed, {
            created,
            updated,
            currentProduct: squareProduct.name,
          });
        }

        cursor = result.cursor;
      } while (cursor);

      await syncStatus.completeSync(true);

      console.log(`✅ Products seeded: ${created} created, ${updated} updated`);

      return { total: processed, created, updated };
    } catch (error: any) {
      await syncStatus.completeSync(false, error.message);
      throw error;
    }
  }

  /**
   * ADMIN CUSTOMIZATION HELPERS
   */

  // Create default featured items for admin to customize
  async createDefaultFeaturedItems() {
    console.log("⭐ Setting up default featured items...");

    // Feature first 6 products by default
    const products = await SquareProduct.findAll({
      where: { isVisible: true, isDeleted: false },
      limit: 6,
      order: [["createdAt", "ASC"]],
    });

    for (let i = 0; i < products.length; i++) {
      await products[i].updateAdminSettings({
        isFeatured: true,
        featuredOrder: i + 1,
      });
    }

    // Feature first 5 categories by default
    const categories = await SquareCategory.findAll({
      where: { isVisible: true, isDeleted: false },
      limit: 5,
      order: [["createdAt", "ASC"]],
    });

    for (let i = 0; i < categories.length; i++) {
      await categories[i].updateAdminSettings({
        isFeatured: true,
        featuredOrder: i + 1,
      });
    }

    console.log(
      `✅ Featured ${products.length} products and ${categories.length} categories by default`
    );
  }

  /**
   * COMPREHENSIVE ANIME STORE SEEDING
   */

  // Seed complete anime inventory with real product data
  async seedCompleteAnimeInventory() {
    console.log("🎌 Starting comprehensive anime inventory seeding...");

    const syncStatus = await SquareSyncStatus.startSync("anime_inventory");

    try {
      // Step 1: Seed all anime categories
      const categoriesResult = await this.seedAnimeCategories();

      // Step 2: Seed all anime products
      const productsResult = await this.seedAnimeProducts();

      // Step 3: Create product-category relationships
      await this.createProductCategoryRelationships();

      // Step 4: Set up featured items based on seed data
      await this.setupFeaturedAnimeItems();

      await syncStatus.completeSync(true);

      console.log("🎉 Complete anime inventory seeded successfully!");

      return {
        success: true,
        categories: categoriesResult,
        products: productsResult,
        message:
          "Comprehensive anime inventory seeded with realistic Square catalog data",
      };
    } catch (error: any) {
      await syncStatus.completeSync(false, error.message);
      console.error("❌ Anime inventory seeding failed:", error);
      throw error;
    }
  }

  // Create comprehensive anime categories from seed data
  async seedAnimeCategories() {
    console.log("📂 Seeding comprehensive anime categories...");

    let created = 0;
    let updated = 0;

    for (const categorySeed of animeCategoriesSeeds) {
      const [category, wasCreated] = await SquareCategory.upsert({
        squareId: categorySeed.squareId,
        squareVersion: 1, // Simulated version
        name: categorySeed.name,
        parentCategoryId: categorySeed.parentCategoryId,
        squareParentCategoryId: categorySeed.parentCategoryId,
        isDeleted: false,
        squareUpdatedAt: new Date(),

        // Admin fields from seed data
        isFeatured: categorySeed.isFeatured || false,
        isVisible: true,
        customName: categorySeed.customName,
        customDescription:
          categorySeed.customDescription || categorySeed.description,
      });

      if (wasCreated) {
        created++;
        console.log(`✅ Created category: ${categorySeed.name}`);
      } else {
        updated++;
        console.log(`📝 Updated category: ${categorySeed.name}`);
      }
    }

    console.log(`🎌 Categories seeded: ${created} created, ${updated} updated`);
    return { total: animeCategoriesSeeds.length, created, updated };
  }

  // Create comprehensive anime products from seed data
  async seedAnimeProducts() {
    console.log("📦 Seeding comprehensive anime products...");

    let created = 0;
    let updated = 0;

    for (const productSeed of animeProductSeeds) {
      const [product, wasCreated] = await SquareProduct.upsert({
        squareId: productSeed.squareId,
        squareVersion: 1, // Simulated version
        name: productSeed.name,
        description: productSeed.description,
        images: JSON.stringify(productSeed.images.map((url) => ({ url }))),
        variations: JSON.stringify(
          productSeed.variations.map((variation) => ({
            id: variation.id,
            name: variation.name,
            priceMoney: {
              amount: Math.round(variation.price * 100), // Convert to cents
              currency: "USD",
            },
            sku: variation.sku,
          }))
        ),
        isDeleted: false,
        squareUpdatedAt: new Date(),

        // Admin fields from seed data
        isFeatured: productSeed.isFeatured || false,
        isVisible: true,
        customDescription: `${productSeed.description}\n\nSeries: ${
          productSeed.series
        }${
          productSeed.character ? `\nCharacter: ${productSeed.character}` : ""
        }\nTags: ${productSeed.tags.join(", ")}`,
        adminNotes: `Series: ${
          productSeed.series
        } | Tags: ${productSeed.tags.join(", ")}${
          productSeed.isPreorder ? " | PREORDER ITEM" : ""
        }${productSeed.isNewArrival ? " | NEW ARRIVAL" : ""}`,
      });

      if (wasCreated) {
        created++;
        console.log(`✅ Created product: ${productSeed.name}`);
      } else {
        updated++;
        console.log(`📝 Updated product: ${productSeed.name}`);
      }
    }

    console.log(`🎌 Products seeded: ${created} created, ${updated} updated`);
    return { total: animeProductSeeds.length, created, updated };
  }

  // Create product-category relationships from seed data
  async createProductCategoryRelationships() {
    console.log("🔗 Creating product-category relationships...");

    // Import the product_categories table model (we'll need to create this)
    const { sequelize } = require("../db/models/squareProduct");

    let relationshipsCreated = 0;

    for (const productSeed of animeProductSeeds) {
      for (let i = 0; i < productSeed.categoryIds.length; i++) {
        const categoryId = productSeed.categoryIds[i];
        const isPrimary = i === 0; // First category is primary

        try {
          await sequelize.query(
            `INSERT INTO product_categories (product_square_id, category_square_id, is_primary)
             VALUES (:productId, :categoryId, :isPrimary)
             ON CONFLICT (product_square_id, category_square_id) DO NOTHING`,
            {
              replacements: {
                productId: productSeed.squareId,
                categoryId: categoryId,
                isPrimary: isPrimary,
              },
            }
          );
          relationshipsCreated++;
        } catch (error: any) {
          // Silently continue if relationship already exists
          if (!error.message.includes("duplicate")) {
            console.warn(
              `⚠️ Failed to create relationship for ${productSeed.name} -> ${categoryId}`
            );
          }
        }
      }
    }

    console.log(
      `🔗 Created ${relationshipsCreated} product-category relationships`
    );
  }

  // Set up featured items based on seed data
  async setupFeaturedAnimeItems() {
    console.log("⭐ Setting up featured anime items...");

    // Update featured order for featured products
    const featuredProducts = animeProductSeeds.filter((p) => p.isFeatured);
    for (let i = 0; i < featuredProducts.length; i++) {
      const product = await SquareProduct.findOne({
        where: { squareId: featuredProducts[i].squareId },
      });

      if (product) {
        await product.update({ featuredOrder: i + 1 });
      }
    }

    // Update featured order for featured categories
    const featuredCategories = animeCategoriesSeeds.filter((c) => c.isFeatured);
    for (let i = 0; i < featuredCategories.length; i++) {
      const category = await SquareCategory.findOne({
        where: { squareId: featuredCategories[i].squareId },
      });

      if (category) {
        await category.update({ featuredOrder: i + 1 });
      }
    }

    console.log(
      `⭐ Set up ${featuredProducts.length} featured products and ${featuredCategories.length} featured categories`
    );
  }

  // Legacy method compatibility - now points to comprehensive seeding
  async seedAnimeData() {
    return this.seedCompleteAnimeInventory();
  }

  /**
   * UTILITY METHODS
   */

  // Get seeding statistics
  async getSeedingStats() {
    const [
      totalProducts,
      featuredProducts,
      totalCategories,
      featuredCategories,
      lastSync,
    ] = await Promise.all([
      SquareProduct.count({ where: { isVisible: true, isDeleted: false } }),
      SquareProduct.count({ where: { isFeatured: true, isVisible: true } }),
      SquareCategory.count({ where: { isVisible: true, isDeleted: false } }),
      SquareCategory.count({ where: { isFeatured: true, isVisible: true } }),
      SquareSyncStatus.findOne({
        order: [["startedAt", "DESC"]],
      }),
    ]);

    return {
      products: {
        total: totalProducts,
        featured: featuredProducts,
      },
      categories: {
        total: totalCategories,
        featured: featuredCategories,
      },
      lastSync: lastSync
        ? {
            type: lastSync.syncType,
            status: lastSync.status,
            startedAt: lastSync.startedAt,
            completedAt: lastSync.completedAt,
          }
        : null,
    };
  }

  // Clear all seeded data (for development)
  async clearAll() {
    console.log("🗑️ Clearing all seeded Square data...");

    await SquareProduct.destroy({ where: {} });
    await SquareCategory.destroy({ where: {} });
    await SquareSyncStatus.destroy({ where: {} });

    console.log("✅ All seeded data cleared");
  }
}

// Export singleton instance
export const squareSeeder = new SquareSeederService();
