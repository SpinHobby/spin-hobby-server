import express from "express";
import { SquareProduct, SquareCategory } from "../db/models/initModels";
import { Op } from "sequelize";

const router = express.Router();

// GET /api/v1/products/featured - Featured products from database
router.get("/v1/products/featured", async (req, res) => {
  try {
    const { limit = 12 } = req.query;

    const featuredProducts = await SquareProduct.findAll({
      where: {
        isFeatured: true,
        isVisible: true,
        isDeleted: false,
      },
      include: [
        {
          model: SquareCategory,
          as: "SquareCategories",
          through: { attributes: [] },
          where: { isVisible: true },
          required: false,
        },
      ],
      order: [
        ["featuredOrder", "ASC"],
        ["createdAt", "DESC"],
      ],
      limit: parseInt(limit as string),
    });

    const transformedProducts = featuredProducts.map((product) => ({
      id: product.squareId,
      name: product.name,
      description: product.customDescription || product.description,
      price:
        product.customPrice || extractPriceFromVariations(product.variations),
      images: JSON.parse(product.images || "[]"),
      featured: product.isFeatured,
      series: extractSeriesFromNotes(product.adminNotes),
      character: extractCharacterFromNotes(product.adminNotes),
      tags: extractTagsFromNotes(product.adminNotes),
      categories:
        product.SquareCategories?.map((cat) => ({
          id: cat.squareId,
          name: cat.customName || cat.name,
        })) || [],
      variations: JSON.parse(product.variations || "[]"),
    }));

    res.json({
      success: true,
      data: transformedProducts,
      meta: {
        total: transformedProducts.length,
        hasRealData: true,
        dataSource: "database",
      },
    });
  } catch (error: any) {
    console.error("Error fetching featured products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch featured products",
    });
  }
});

// GET /api/v1/products/popular - Popular products by series
router.get("/v1/products/popular", async (req, res) => {
  try {
    const { series, limit = 20 } = req.query;

    const whereClause: any = {
      isVisible: true,
      isDeleted: false,
    };

    // Filter by series if specified
    if (series) {
      whereClause.adminNotes = {
        [Op.iLike]: `%Series: ${series}%`,
      };
    }

    const popularProducts = await SquareProduct.findAll({
      where: whereClause,
      include: [
        {
          model: SquareCategory,
          as: "SquareCategories",
          through: { attributes: [] },
          where: { isVisible: true },
          required: false,
        },
      ],
      order: [
        ["isFeatured", "DESC"],
        ["createdAt", "DESC"],
      ],
      limit: parseInt(limit as string),
    });

    if (series) {
      // Return flat list for specific series
      const transformedProducts = popularProducts.map((product) => ({
        id: product.squareId,
        title: product.name,
        name: product.name,
        description: product.customDescription || product.description,
        price:
          product.customPrice || extractPriceFromVariations(product.variations),
        images: JSON.parse(product.images || "[]"),
        featured: product.isFeatured,
        series: extractSeriesFromNotes(product.adminNotes),
        character: extractCharacterFromNotes(product.adminNotes),
        tags: extractTagsFromNotes(product.adminNotes),
        productType: getProductTypeFromCategories(product.SquareCategories),
      }));

      res.json(transformedProducts);
    } else {
      // Group by series for popular by series format
      const groupedBySeries: { [key: string]: any[] } = {};

      popularProducts.forEach((product) => {
        const productSeries =
          extractSeriesFromNotes(product.adminNotes) || "Other";
        if (!groupedBySeries[productSeries]) {
          groupedBySeries[productSeries] = [];
        }

        groupedBySeries[productSeries].push({
          id: product.squareId,
          title: product.name,
          name: product.name,
          description: product.customDescription || product.description,
          price:
            product.customPrice ||
            extractPriceFromVariations(product.variations),
          images: JSON.parse(product.images || "[]"),
          featured: product.isFeatured,
          series: productSeries,
          character: extractCharacterFromNotes(product.adminNotes),
          tags: extractTagsFromNotes(product.adminNotes),
          productType: getProductTypeFromCategories(product.SquareCategories),
        });
      });

      const transformedData = Object.keys(groupedBySeries).map(
        (seriesName) => ({
          series: seriesName,
          merchs: groupedBySeries[seriesName].slice(0, 6), // Limit to 6 per series
        })
      );

      res.json(transformedData);
    }
  } catch (error: any) {
    console.error("Error fetching popular products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch popular products",
    });
  }
});

// GET /api/v1/products/preorders - Preorder items
router.get("/v1/products/preorders", async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const preorderProducts = await SquareProduct.findAll({
      where: {
        adminNotes: {
          [Op.iLike]: "%PREORDER ITEM%",
        },
        isVisible: true,
        isDeleted: false,
      },
      include: [
        {
          model: SquareCategory,
          as: "SquareCategories",
          through: { attributes: [] },
          where: { isVisible: true },
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit as string),
    });

    const transformedProducts = preorderProducts.map((product) => ({
      id: product.squareId,
      title: product.name,
      name: product.name,
      description: product.customDescription || product.description,
      price:
        product.customPrice || extractPriceFromVariations(product.variations),
      images: JSON.parse(product.images || "[]"),
      series: extractSeriesFromNotes(product.adminNotes),
      character: extractCharacterFromNotes(product.adminNotes),
      tags: [...extractTagsFromNotes(product.adminNotes), "preorder"],
      estimatedRelease: "Q3 2024", // Could be stored in adminNotes
      preorder: true,
      productType: getProductTypeFromCategories(product.SquareCategories),
      categories:
        product.SquareCategories?.map((cat) => ({
          id: cat.squareId,
          name: cat.customName || cat.name,
        })) || [],
    }));

    res.json(transformedProducts);
  } catch (error: any) {
    console.error("Error fetching preorder items:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch preorder items",
    });
  }
});

// GET /api/v1/products/new-arrivals - New arrivals
router.get("/v1/products/new-arrivals", async (req, res) => {
  try {
    const { limit = 12 } = req.query;

    const newProducts = await SquareProduct.findAll({
      where: {
        [Op.or]: [
          {
            adminNotes: {
              [Op.iLike]: "%NEW ARRIVAL%",
            },
          },
          {
            createdAt: {
              [Op.gte]: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
            },
          },
        ],
        isVisible: true,
        isDeleted: false,
      },
      include: [
        {
          model: SquareCategory,
          as: "SquareCategories",
          through: { attributes: [] },
          where: { isVisible: true },
          required: false,
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit as string),
    });

    const transformedProducts = newProducts.map((product) => ({
      id: product.squareId,
      title: product.name,
      name: product.name,
      description: product.customDescription || product.description,
      price:
        product.customPrice || extractPriceFromVariations(product.variations),
      images: JSON.parse(product.images || "[]"),
      featured: product.isFeatured,
      series: extractSeriesFromNotes(product.adminNotes),
      character: extractCharacterFromNotes(product.adminNotes),
      tags: [...extractTagsFromNotes(product.adminNotes), "new-arrival"],
      productType: getProductTypeFromCategories(product.SquareCategories),
      createdAt: product.createdAt,
      categories:
        product.SquareCategories?.map((cat) => ({
          id: cat.squareId,
          name: cat.customName || cat.name,
        })) || [],
    }));

    res.json(transformedProducts);
  } catch (error: any) {
    console.error("Error fetching new arrivals:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch new arrivals",
    });
  }
});

// GET /api/v1/products/search - Search products with anime filters
router.get("/v1/products/search", async (req, res) => {
  try {
    const {
      series,
      character,
      productType,
      inStock,
      preorder,
      page = 1,
      limit = 20,
      q, // Search query
    } = req.query;

    const whereClause: any = {
      isVisible: true,
      isDeleted: false,
    };

    // Search by name or description
    if (q) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${q}%` } },
        { description: { [Op.iLike]: `%${q}%` } },
        { customDescription: { [Op.iLike]: `%${q}%` } },
        { adminNotes: { [Op.iLike]: `%${q}%` } },
      ];
    }

    // Filter by series
    if (series) {
      whereClause.adminNotes = {
        [Op.iLike]: `%Series: ${series}%`,
      };
    }

    // Filter by character
    if (character) {
      if (whereClause.adminNotes) {
        whereClause[Op.and] = [
          whereClause.adminNotes,
          { adminNotes: { [Op.iLike]: `%Character: ${character}%` } },
        ];
        delete whereClause.adminNotes;
      } else {
        whereClause.adminNotes = {
          [Op.iLike]: `%Character: ${character}%`,
        };
      }
    }

    // Filter by preorder status
    if (preorder !== undefined) {
      const isPreorder = preorder === "true";
      if (isPreorder) {
        whereClause.adminNotes = {
          [Op.iLike]: "%PREORDER ITEM%",
        };
      } else {
        whereClause.adminNotes = {
          [Op.notILike]: "%PREORDER ITEM%",
        };
      }
    }

    const includeClause: any = [
      {
        model: SquareCategory,
        as: "SquareCategories",
        through: { attributes: [] },
        where: { isVisible: true },
        required: false,
      },
    ];

    // Filter by product type (category)
    if (productType) {
      includeClause[0].where.name = { [Op.iLike]: `%${productType}%` };
      includeClause[0].required = true;
    }

    // Pagination
    const pageNum = parseInt(page.toString());
    const limitNum = parseInt(limit.toString());
    const offset = (pageNum - 1) * limitNum;

    const products = await SquareProduct.findAndCountAll({
      where: whereClause,
      include: includeClause,
      order: [
        ["isFeatured", "DESC"],
        ["createdAt", "DESC"],
      ],
      limit: limitNum,
      offset: offset,
    });

    const transformedProducts = products.rows.map((product) => ({
      id: product.squareId,
      title: product.name,
      name: product.name,
      description: product.customDescription || product.description,
      price:
        product.customPrice || extractPriceFromVariations(product.variations),
      images: JSON.parse(product.images || "[]"),
      featured: product.isFeatured,
      series: extractSeriesFromNotes(product.adminNotes),
      character: extractCharacterFromNotes(product.adminNotes),
      tags: extractTagsFromNotes(product.adminNotes),
      productType: getProductTypeFromCategories(product.SquareCategories),
      preorder: product.adminNotes?.includes("PREORDER ITEM") || false,
      categories:
        product.SquareCategories?.map((cat) => ({
          id: cat.squareId,
          name: cat.customName || cat.name,
        })) || [],
    }));

    res.json({
      products: transformedProducts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: products.count,
        pages: Math.ceil(products.count / limitNum),
      },
      meta: {
        hasRealData: true,
        dataSource: "database",
      },
    });
  } catch (error: any) {
    console.error("Error searching products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to search products",
    });
  }
});

// Helper functions to extract data from adminNotes
function extractSeriesFromNotes(adminNotes: string | null): string | null {
  if (!adminNotes) return null;
  const match = adminNotes.match(/Series: ([^|]+)/);
  return match ? match[1].trim() : null;
}

function extractCharacterFromNotes(adminNotes: string | null): string | null {
  if (!adminNotes) return null;
  const match = adminNotes.match(/Character: ([^|]+)/);
  return match ? match[1].trim() : null;
}

function extractTagsFromNotes(adminNotes: string | null): string[] {
  if (!adminNotes) return [];
  const match = adminNotes.match(/Tags: ([^|]+)/);
  if (!match) return [];
  return match[1].split(", ").map((tag) => tag.trim());
}

function extractPriceFromVariations(variationsJson: string | null): number {
  if (!variationsJson) return 0;
  try {
    const variations = JSON.parse(variationsJson);
    if (variations.length > 0 && variations[0].priceMoney) {
      return variations[0].priceMoney.amount / 100; // Convert from cents
    }
  } catch (error) {
    console.warn("Failed to parse variations JSON:", error);
  }
  return 0;
}

function getProductTypeFromCategories(categories: any[]): string {
  if (!categories || categories.length === 0) return "Other";

  // Return the primary category or first category
  const primaryCategory = categories.find((cat) => cat.name) || categories[0];
  return primaryCategory?.name || "Other";
}

export default router;
