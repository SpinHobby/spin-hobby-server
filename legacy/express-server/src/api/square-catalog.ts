import express from "express";
import { SquareService } from "../services/square";

const router = express.Router();
const squareService = new SquareService();

/**
 * SQUARE CATALOG API ENDPOINTS
 * Direct access to real Square catalog data
 */

// GET /api/v1/square-catalog/products - Get real products from Square
router.get("/v1/square-catalog/products", async (req, res) => {
  try {
    const { cursor, limit = 20, page = 1 } = req.query;

    console.log("Fetching real products from Square catalog...");

    const squareResponse = await squareService.getProducts(cursor as string);

    // Transform Square products to our format
    const transformedProducts = squareResponse.products.map((product: any) => ({
      id: product.id,
      title: product.name,
      name: product.name,
      description: product.description || `Premium ${product.name}`,
      price: product.price || 29.99,
      img:
        product.images?.[0] ||
        "https://via.placeholder.com/400x400?text=No+Image",
      images: product.images || [],
      variations: product.variations || [],
      categories: product.categories || [],
      isFeatured: false,
      isNewArrival: false,
      isPreorder: false,
      series: product.category || "Unknown Series",
      character: product.name.split(" ")[0] || "Unknown",
      tags: product.tags || [],
      source: "square-catalog",
    }));

    res.json({
      success: true,
      data: transformedProducts,
      meta: {
        total: transformedProducts.length,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        hasMore: squareResponse.hasMore,
        cursor: squareResponse.cursor,
        source: "square-catalog",
        isRealData: true,
      },
    });
  } catch (error: any) {
    console.error("Error fetching Square catalog products:", error);

    // Return fallback message with helpful debugging info
    res.status(500).json({
      success: false,
      error: "Failed to fetch Square catalog products",
      details: error.message,
      help: "Make sure Square API credentials are configured in .env file",
      fallback: "Using dummy data instead",
    });
  }
});

// GET /api/v1/square-catalog/search - Search real Square catalog
router.get("/v1/square-catalog/search", async (req, res) => {
  try {
    const { q: query, category } = req.query;

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    console.log(`Searching Square catalog for: "${query}"`);

    const squareResults = await squareService.searchProducts(query);

    // Transform Square search results
    const transformedResults = squareResults.map((product: any) => ({
      id: product.id,
      title: product.name,
      name: product.name,
      description: product.description || `Premium ${product.name}`,
      price: product.price || 29.99,
      img:
        product.images?.[0] ||
        "https://via.placeholder.com/400x400?text=No+Image",
      images: product.images || [],
      variations: product.variations || [],
      categories: product.categories || [],
      isFeatured: false,
      isNewArrival: false,
      isPreorder: false,
      source: "square-catalog",
    }));

    res.json({
      success: true,
      data: transformedResults,
      meta: {
        query,
        found: transformedResults.length,
        source: "square-catalog",
        isRealData: true,
      },
    });
  } catch (error: any) {
    console.error("Error searching Square catalog:", error);

    res.status(500).json({
      success: false,
      error: "Failed to search Square catalog",
      details: error.message,
      help: "Make sure Square API credentials are configured in .env file",
    });
  }
});

// GET /api/v1/square-catalog/categories - Get real categories from Square
router.get("/v1/square-catalog/categories", async (req, res) => {
  try {
    console.log("Fetching real categories from Square catalog...");

    const categories = await squareService.getCategories();

    const transformedCategories = categories.map((category: any) => ({
      id: category.id,
      name: category.name,
      description: category.description || `Browse ${category.name} collection`,
      img:
        "https://via.placeholder.com/300x200?text=" +
        encodeURIComponent(category.name),
      productCount: 0, // Square doesn't provide count directly
      featured: true,
      source: "square-catalog",
    }));

    res.json({
      success: true,
      data: transformedCategories,
      meta: {
        total: transformedCategories.length,
        source: "square-catalog",
        isRealData: true,
      },
    });
  } catch (error: any) {
    console.error("Error fetching Square catalog categories:", error);

    res.status(500).json({
      success: false,
      error: "Failed to fetch Square catalog categories",
      details: error.message,
      help: "Make sure Square API credentials are configured in .env file",
    });
  }
});

// GET /api/v1/square-catalog/test - Test Square API connection
router.get("/v1/square-catalog/test", async (req, res) => {
  try {
    console.log("Testing Square API connection...");

    // Try to get a small number of products to test connection
    const testResult = await squareService.getProducts();

    res.json({
      success: true,
      message: "Square API connection successful!",
      data: {
        productsFound: testResult.products.length,
        hasMore: testResult.hasMore,
        sampleProduct: testResult.products[0] || null,
      },
      meta: {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || "development",
        hasSquareCredentials: !!(
          process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_ACCESS_TOKEN
        ),
      },
    });
  } catch (error: any) {
    console.error("Square API test failed:", error);

    res.status(500).json({
      success: false,
      error: "Square API connection failed",
      details: error.message,
      help: {
        message: "Check your Square API credentials",
        requiredEnvVars: [
          "SQUARE_APPLICATION_ID",
          "SQUARE_ACCESS_TOKEN",
          "SQUARE_LOCATION_ID",
        ],
        documentation:
          "https://developer.squareup.com/docs/catalog-api/what-it-does",
      },
    });
  }
});

export default router;
