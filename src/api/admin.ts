import express from "express";
import {
  SquareProduct,
  SquareCategory,
  SquareSyncStatus,
} from "../db/models/initModels";
import { Op } from "sequelize";
import adminCategoriesRouter from "./admin/categories";

const router = express.Router();

// Mount admin sub-routers
router.use("/v1/admin/categories", adminCategoriesRouter);

/**
 * ADMIN FEATURED MANAGEMENT
 */

// GET /api/v1/admin/featured - Get current featured configuration
router.get("/v1/admin/featured", async (req, res) => {
  try {
    const [featuredProducts, featuredCategories] = await Promise.all([
      SquareProduct.findAll({
        where: { isFeatured: true, isVisible: true },
        order: [
          ["featuredOrder", "ASC"],
          ["createdAt", "DESC"],
        ],
        attributes: [
          "id",
          "squareId",
          "name",
          "description",
          "customDescription",
          "customPrice",
          "featuredOrder",
          "images",
          "variations",
        ],
      }),
      SquareCategory.findAll({
        where: { isFeatured: true, isVisible: true },
        order: [
          ["featuredOrder", "ASC"],
          ["name", "ASC"],
        ],
        attributes: [
          "id",
          "squareId",
          "name",
          "customName",
          "customDescription",
          "featuredOrder",
        ],
      }),
    ]);

    res.json({
      success: true,
      data: {
        featuredProducts: featuredProducts.map((p) => p.getDisplayData()),
        featuredCategories: featuredCategories.map((c) => c.getDisplayData()),
      },
    });
  } catch (error: any) {
    console.error("❌ Failed to get featured items:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get featured items",
    });
  }
});

// POST /api/v1/admin/featured/products - Update featured products
router.post("/v1/admin/featured/products", async (req, res) => {
  try {
    const { productIds } = req.body; // Array of product IDs in display order

    if (!Array.isArray(productIds)) {
      return res.status(400).json({
        success: false,
        error: "productIds must be an array",
      });
    }

    // First, unfeature all products
    await SquareProduct.update(
      { isFeatured: false, featuredOrder: null },
      { where: { isFeatured: true } }
    );

    // Then feature the selected products in order
    for (let i = 0; i < productIds.length; i++) {
      await SquareProduct.update(
        { isFeatured: true, featuredOrder: i + 1 },
        { where: { id: productIds[i] } }
      );
    }

    const updatedProducts = await SquareProduct.findAll({
      where: { isFeatured: true },
      order: [["featuredOrder", "ASC"]],
    });

    res.json({
      success: true,
      message: `Updated ${productIds.length} featured products`,
      data: updatedProducts.map((p) => p.getDisplayData()),
    });
  } catch (error: any) {
    console.error("❌ Failed to update featured products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update featured products",
    });
  }
});

// POST /api/v1/admin/featured/categories - Update featured categories
router.post("/v1/admin/featured/categories", async (req, res) => {
  try {
    const { categoryIds } = req.body; // Array of category IDs in display order

    if (!Array.isArray(categoryIds)) {
      return res.status(400).json({
        success: false,
        error: "categoryIds must be an array",
      });
    }

    // First, unfeature all categories
    await SquareCategory.update(
      { isFeatured: false, featuredOrder: null },
      { where: { isFeatured: true } }
    );

    // Then feature the selected categories in order
    for (let i = 0; i < categoryIds.length; i++) {
      await SquareCategory.update(
        { isFeatured: true, featuredOrder: i + 1 },
        { where: { id: categoryIds[i] } }
      );
    }

    const updatedCategories = await SquareCategory.findAll({
      where: { isFeatured: true },
      order: [["featuredOrder", "ASC"]],
    });

    res.json({
      success: true,
      message: `Updated ${categoryIds.length} featured categories`,
      data: updatedCategories.map((c) => c.getDisplayData()),
    });
  } catch (error: any) {
    console.error("❌ Failed to update featured categories:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update featured categories",
    });
  }
});

/**
 * ADMIN PRODUCT MANAGEMENT
 */

// GET /api/v1/admin/products - Get all products for admin management
router.get("/v1/admin/products", async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, featured } = req.query;

    const where: any = { isDeleted: false };

    // Add search filter
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Add category filter
    if (category) {
      where.squareCategoryId = category;
    }

    // Add featured filter
    if (featured !== undefined) {
      where.isFeatured = featured === "true";
    }

    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    const { count, rows: products } = await SquareProduct.findAndCountAll({
      where,
      limit: parseInt(limit as string),
      offset,
      order: [
        ["isFeatured", "DESC"],
        ["featuredOrder", "ASC"],
        ["createdAt", "DESC"],
      ],
    });

    res.json({
      success: true,
      data: {
        products: products.map((p) => p.getDisplayData()),
        pagination: {
          total: count,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          totalPages: Math.ceil(count / parseInt(limit as string)),
        },
      },
    });
  } catch (error: any) {
    console.error("❌ Failed to get admin products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get products",
    });
  }
});

// PUT /api/v1/admin/products/:id - Update product admin settings
router.put("/v1/admin/products/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const settings = req.body;

    const product = await SquareProduct.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: "Product not found",
      });
    }

    await product.updateAdminSettings(settings);

    res.json({
      success: true,
      message: "Product updated successfully",
      data: product.getDisplayData(),
    });
  } catch (error: any) {
    console.error("❌ Failed to update product:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update product",
    });
  }
});

/**
 * ADMIN CATEGORY MANAGEMENT
 */

// GET /api/v1/admin/categories - Get all categories for admin management
router.get("/v1/admin/categories", async (req, res) => {
  try {
    const { search, featured } = req.query;

    const where: any = { isDeleted: false };

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { customName: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (featured !== undefined) {
      where.isFeatured = featured === "true";
    }

    const categories = await SquareCategory.findAll({
      where,
      order: [
        ["isFeatured", "DESC"],
        ["featuredOrder", "ASC"],
        ["name", "ASC"],
      ],
    });

    res.json({
      success: true,
      data: categories.map((c) => c.getDisplayData()),
    });
  } catch (error: any) {
    console.error("❌ Failed to get admin categories:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get categories",
    });
  }
});

// PUT /api/v1/admin/categories/:id - Update category admin settings
router.put("/v1/admin/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const settings = req.body;

    const category = await SquareCategory.findByPk(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    await category.updateAdminSettings(settings);

    res.json({
      success: true,
      message: "Category updated successfully",
      data: category.getDisplayData(),
    });
  } catch (error: any) {
    console.error("❌ Failed to update category:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update category",
    });
  }
});

/**
 * ADMIN DASHBOARD STATS
 */

// GET /api/v1/admin/dashboard - Get admin dashboard statistics
router.get("/v1/admin/dashboard", async (req, res) => {
  try {
    const [
      totalProducts,
      visibleProducts,
      featuredProducts,
      totalCategories,
      featuredCategories,
      recentSyncs,
    ] = await Promise.all([
      SquareProduct.count({ where: { isDeleted: false } }),
      SquareProduct.count({ where: { isVisible: true, isDeleted: false } }),
      SquareProduct.count({ where: { isFeatured: true, isVisible: true } }),
      SquareCategory.count({ where: { isDeleted: false } }),
      SquareCategory.count({ where: { isFeatured: true, isVisible: true } }),
      SquareSyncStatus.findAll({
        limit: 5,
        order: [["startedAt", "DESC"]],
        attributes: [
          "syncType",
          "status",
          "startedAt",
          "completedAt",
          "itemsProcessed",
          "itemsTotal",
        ],
      }),
    ]);

    res.json({
      success: true,
      data: {
        overview: {
          totalProducts,
          visibleProducts,
          featuredProducts,
          totalCategories,
          featuredCategories,
        },
        recentSyncs: recentSyncs.map((sync) => ({
          type: sync.syncType,
          status: sync.status,
          startedAt: sync.startedAt,
          completedAt: sync.completedAt,
          progress: sync.itemsTotal
            ? Math.round((sync.itemsProcessed / sync.itemsTotal) * 100)
            : 0,
        })),
      },
    });
  } catch (error: any) {
    console.error("❌ Failed to get dashboard stats:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to get dashboard statistics",
    });
  }
});

export default router;
