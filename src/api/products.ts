import express from "express";

const router = express.Router();

// Import dummy data
import {
  featuredMerchandise,
  popularBySeriesData,
  preorderItems,
  newArrivals,
} from "../data/dummyData";

// GET /api/v1/products/featured - Featured merchandise
router.get("/v1/products/featured", (req, res) => {
  try {
    res.json(featuredMerchandise);
  } catch (error) {
    console.error("Error fetching featured products:", error);
    res.status(500).json({ error: "Failed to fetch featured products" });
  }
});

// GET /api/v1/products/popular - Popular products
router.get("/v1/products/popular", (req, res) => {
  try {
    const { series } = req.query;

    if (series) {
      // Filter by series
      const filteredData = popularBySeriesData.filter(
        (group) =>
          group.series?.toLowerCase() === series.toString().toLowerCase()
      );
      const allMerchs = filteredData.flatMap((group) => group.merchs);
      res.json(allMerchs);
    } else {
      // Return all popular items
      const allMerchs = popularBySeriesData.flatMap((group) => group.merchs);
      res.json(allMerchs);
    }
  } catch (error) {
    console.error("Error fetching popular products:", error);
    res.status(500).json({ error: "Failed to fetch popular products" });
  }
});

// GET /api/v1/products/preorders - Preorder items
router.get("/v1/products/preorders", (req, res) => {
  try {
    res.json(preorderItems);
  } catch (error) {
    console.error("Error fetching preorder items:", error);
    res.status(500).json({ error: "Failed to fetch preorder items" });
  }
});

// GET /api/v1/products/new-arrivals - New arrival items
router.get("/v1/products/new-arrivals", (req, res) => {
  try {
    res.json(newArrivals);
  } catch (error) {
    console.error("Error fetching new arrivals:", error);
    res.status(500).json({ error: "Failed to fetch new arrivals" });
  }
});

// GET /api/v1/products/search - Search products with anime filters
router.get("/v1/products/search", (req, res) => {
  try {
    const {
      series,
      character,
      productType,
      inStock,
      preorder,
      page = 1,
      limit = 20,
    } = req.query;

    // Get all products from all groups
    let allProducts = popularBySeriesData.flatMap((group) => group.merchs);

    // Add featured products
    allProducts = [...allProducts, ...featuredMerchandise];

    // Remove duplicates based on title
    allProducts = allProducts.filter(
      (product, index, array) =>
        array.findIndex((p) => p.title === product.title) === index
    );

    // Apply filters
    let filteredProducts = allProducts;

    if (series) {
      filteredProducts = filteredProducts.filter((product) =>
        product.series?.toLowerCase().includes(series.toString().toLowerCase())
      );
    }

    if (character) {
      filteredProducts = filteredProducts.filter((product) =>
        product.character
          ?.toLowerCase()
          .includes(character.toString().toLowerCase())
      );
    }

    if (productType) {
      filteredProducts = filteredProducts.filter((product) =>
        product.productType
          ?.toLowerCase()
          .includes(productType.toString().toLowerCase())
      );
    }

    if (preorder !== undefined) {
      const isPreorder = preorder === "true";
      filteredProducts = filteredProducts.filter(
        (product) => product.preorder === isPreorder
      );
    }

    // Pagination
    const pageNum = parseInt(page.toString());
    const limitNum = parseInt(limit.toString());
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;

    const paginatedProducts = filteredProducts.slice(startIndex, endIndex);

    res.json({
      products: paginatedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredProducts.length,
        pages: Math.ceil(filteredProducts.length / limitNum),
      },
    });
  } catch (error) {
    console.error("Error searching products:", error);
    res.status(500).json({ error: "Failed to search products" });
  }
});

export default router;
