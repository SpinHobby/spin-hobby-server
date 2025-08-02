import express from "express";
import { squareSeeder } from "../services/squareSeeder";
import { squareService } from "../services/square";

const router = express.Router();

/**
 * SEEDING ENDPOINTS
 */

// POST /api/v1/seed/all - Seed all Square data
router.post("/v1/seed/all", async (req, res) => {
  try {
    console.log("🌱 Starting complete Square data seeding...");

    const result = await squareSeeder.seedAll();

    res.json({
      success: true,
      message: "Square data seeded successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Seeding failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to seed Square data",
    });
  }
});

// POST /api/v1/seed/categories - Seed only categories
router.post("/v1/seed/categories", async (req, res) => {
  try {
    const result = await squareSeeder.seedCategories();

    res.json({
      success: true,
      message: "Categories seeded successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Category seeding failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to seed categories",
    });
  }
});

// POST /api/v1/seed/products - Seed only products
router.post("/v1/seed/products", async (req, res) => {
  try {
    const result = await squareSeeder.seedProducts();

    res.json({
      success: true,
      message: "Products seeded successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Product seeding failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to seed products",
    });
  }
});

// POST /api/v1/seed/anime - Seed comprehensive anime inventory
router.post("/v1/seed/anime", async (req, res) => {
  try {
    const result = await squareSeeder.seedCompleteAnimeInventory();

    res.json({
      success: true,
      message: "Comprehensive anime inventory seeded successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("❌ Anime seeding failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to seed anime inventory",
    });
  }
});

// POST /api/v1/seed/quick-anime - Quick anime seed for development
router.post("/v1/seed/quick-anime", async (req, res) => {
  try {
    console.log("🚀 Quick anime seeding (skips Square API calls)...");

    const result = await squareSeeder.seedCompleteAnimeInventory();

    res.json({
      success: true,
      message: "Quick anime inventory seeded - ready for development!",
      data: result,
      devNote:
        "This seeds realistic anime inventory without calling Square APIs",
    });
  } catch (error: any) {
    console.error("❌ Quick anime seeding failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to quick-seed anime data",
    });
  }
});

// GET /api/v1/seed/status - Get seeding statistics
router.get("/v1/seed/status", async (req, res) => {
  try {
    const stats = await squareSeeder.getSeedingStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error: any) {
    console.error("❌ Failed to get seeding stats:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get seeding statistics",
    });
  }
});

// DELETE /api/v1/seed/clear - Clear all seeded data (development only)
router.delete("/v1/seed/clear", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({
        success: false,
        error: "Cannot clear data in production environment",
      });
    }

    await squareSeeder.clearAll();

    res.json({
      success: true,
      message: "All seeded data cleared successfully",
    });
  } catch (error: any) {
    console.error("❌ Failed to clear data:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to clear data",
    });
  }
});

/**
 * LIVE SQUARE DATA ENDPOINTS
 */

// GET /api/v1/seed/square/test - Test Square API connection
router.get("/v1/seed/square/test", async (req, res) => {
  try {
    // Test basic Square connection
    const categories = await squareService.getCategories();
    const products = await squareService.getProducts();

    res.json({
      success: true,
      message: "Square API connection successful",
      data: {
        categoriesCount: categories.length,
        productsCount: products.products.length,
        hasMoreProducts: products.hasMore,
      },
    });
  } catch (error: any) {
    console.error("❌ Square API test failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Square API connection failed",
    });
  }
});

// GET /api/v1/seed/square/preview - Preview Square data before seeding
router.get("/v1/seed/square/preview", async (req, res) => {
  try {
    const categories = await squareService.getCategories();
    const products = await squareService.getProducts();

    res.json({
      success: true,
      data: {
        categories: {
          count: categories.length,
          sample: categories.slice(0, 3).map((cat) => ({
            id: cat.squareId,
            name: cat.name,
          })),
        },
        products: {
          count: products.products.length,
          hasMore: products.hasMore,
          sample: products.products.slice(0, 3).map((prod) => ({
            id: prod.squareId,
            name: prod.name,
            variations: prod.variations.length,
          })),
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Square preview failed:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to preview Square data",
    });
  }
});

export default router;
