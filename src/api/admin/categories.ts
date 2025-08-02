import express from "express";
import { SquareCategory, SquareProduct } from "../../db/models/initModels";
import { Op } from "sequelize";

const router = express.Router();

/**
 * ADMIN CATEGORY MANAGEMENT ENDPOINTS
 * These endpoints allow admins to manage category visibility, featured status, and assignments
 */

// GET /api/v1/admin/categories - Get all categories with admin details
router.get("/", async (req, res) => {
  try {
    const { include_hidden = true, include_deleted = false } = req.query;

    const whereClause: any = {};

    // Include/exclude hidden categories
    if (!include_hidden) {
      whereClause.isVisible = true;
    }

    // Include/exclude deleted categories
    if (!include_deleted) {
      whereClause.isDeleted = false;
    }

    const categories = await SquareCategory.findAll({
      where: whereClause,
      order: [
        ["isFeatured", "DESC"],
        ["featuredOrder", "ASC"],
        ["name", "ASC"],
      ],
      include: [
        {
          model: SquareCategory,
          as: "subcategories",
          required: false,
        },
      ],
    });

    // Get product counts for each category
    const categoriesWithCounts = await Promise.all(
      categories.map(async (category) => {
        const productCount = await SquareProduct.count({
          include: [
            {
              model: SquareCategory,
              as: "SquareCategories", // Use the many-to-many association alias
              where: { squareId: category.squareId },
              through: { attributes: [] },
            },
          ],
        });

        return {
          id: category.id,
          squareId: category.squareId,
          name: category.name,
          customName: category.customName,
          description: category.description,
          customDescription: category.customDescription,
          parentCategoryId: category.squareParentCategoryId,

          // Admin control fields
          isFeatured: category.isFeatured,
          featuredOrder: category.featuredOrder,
          isVisible: category.isVisible,
          adminNotes: category.adminNotes,

          // Computed fields
          productCount,
          subcategoryCount: category.subcategories?.length || 0,

          // Metadata
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
          lastSyncedAt: category.lastSyncedAt,
          squareUpdatedAt: category.squareUpdatedAt,
        };
      })
    );

    res.json({
      success: true,
      data: categoriesWithCounts,
      meta: {
        total: categoriesWithCounts.length,
        featured: categoriesWithCounts.filter((cat) => cat.isFeatured).length,
        visible: categoriesWithCounts.filter((cat) => cat.isVisible).length,
        hidden: categoriesWithCounts.filter((cat) => !cat.isVisible).length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching admin categories:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch categories",
    });
  }
});

// PUT /api/v1/admin/categories/:categoryId/featured - Toggle featured status
router.put("/:categoryId/featured", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { isFeatured, featuredOrder } = req.body;

    const category = await SquareCategory.findOne({
      where: { squareId: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    // Update featured status
    await category.update({
      isFeatured: isFeatured,
      featuredOrder: featuredOrder || null,
    });

    // If setting as featured and no order specified, auto-assign order
    if (isFeatured && !featuredOrder) {
      const maxOrder = (await SquareCategory.max("featuredOrder", {
        where: { isFeatured: true },
      })) as number;

      await category.update({
        featuredOrder: (maxOrder || 0) + 1,
      });
    }

    res.json({
      success: true,
      message: `Category ${
        isFeatured ? "featured" : "unfeatured"
      } successfully`,
      data: {
        id: category.squareId,
        name: category.name,
        isFeatured: category.isFeatured,
        featuredOrder: category.featuredOrder,
      },
    });
  } catch (error: any) {
    console.error("Error updating category featured status:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update featured status",
    });
  }
});

// PUT /api/v1/admin/categories/:categoryId/visibility - Toggle visibility
router.put("/:categoryId/visibility", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { isVisible } = req.body;

    const category = await SquareCategory.findOne({
      where: { squareId: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    await category.update({ isVisible });

    res.json({
      success: true,
      message: `Category ${isVisible ? "shown" : "hidden"} successfully`,
      data: {
        id: category.squareId,
        name: category.name,
        isVisible: category.isVisible,
      },
    });
  } catch (error: any) {
    console.error("Error updating category visibility:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update visibility",
    });
  }
});

// PUT /api/v1/admin/categories/:categoryId/customize - Update custom fields
router.put("/:categoryId/customize", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { customName, customDescription, adminNotes } = req.body;

    const category = await SquareCategory.findOne({
      where: { squareId: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    await category.update({
      customName: customName || null,
      customDescription: customDescription || null,
      adminNotes: adminNotes || null,
    });

    res.json({
      success: true,
      message: "Category customization updated successfully",
      data: {
        id: category.squareId,
        name: category.name,
        customName: category.customName,
        customDescription: category.customDescription,
        adminNotes: category.adminNotes,
      },
    });
  } catch (error: any) {
    console.error("Error updating category customization:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to update customization",
    });
  }
});

// POST /api/v1/admin/categories/bulk-actions - Bulk actions on categories
router.post("/bulk-actions", async (req, res) => {
  try {
    const { action, categoryIds, data } = req.body;

    if (!action || !categoryIds || !Array.isArray(categoryIds)) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: action and categoryIds array",
      });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const categoryId of categoryIds) {
      try {
        const category = await SquareCategory.findOne({
          where: { squareId: categoryId },
        });

        if (!category) {
          results.failed++;
          results.errors.push(`Category ${categoryId} not found`);
          continue;
        }

        switch (action) {
          case "feature":
            await category.update({
              isFeatured: true,
              featuredOrder: data?.featuredOrder || null,
            });
            break;

          case "unfeature":
            await category.update({
              isFeatured: false,
              featuredOrder: null,
            });
            break;

          case "show":
            await category.update({ isVisible: true });
            break;

          case "hide":
            await category.update({ isVisible: false });
            break;

          case "delete":
            await category.update({ isDeleted: true, isVisible: false });
            break;

          default:
            results.failed++;
            results.errors.push(`Unknown action: ${action}`);
            continue;
        }

        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(
          `Failed to ${action} category ${categoryId}: ${error.message}`
        );
      }
    }

    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      data: results,
    });
  } catch (error: any) {
    console.error("Error performing bulk action:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to perform bulk action",
    });
  }
});

// GET /api/v1/admin/categories/:categoryId/products - Get products in category with admin details
router.get("/:categoryId/products", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { limit = 50, offset = 0, include_hidden = false } = req.query;

    const category = await SquareCategory.findOne({
      where: { squareId: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    const productWhereClause: any = {
      isDeleted: false,
    };

    if (!include_hidden) {
      productWhereClause.isVisible = true;
    }

    const products = await SquareProduct.findAndCountAll({
      include: [
        {
          model: SquareCategory,
          as: "SquareCategories",
          where: { squareId: categoryId },
          through: { attributes: [] },
        },
      ],
      where: productWhereClause,
      order: [
        ["isFeatured", "DESC"],
        ["createdAt", "DESC"],
      ],
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });

    const transformedProducts = products.rows.map((product) => ({
      id: product.squareId,
      name: product.name,
      customDescription: product.customDescription,
      customPrice: product.customPrice,
      images: JSON.parse(product.images || "[]"),

      // Admin fields
      isFeatured: product.isFeatured,
      featuredOrder: product.featuredOrder,
      isVisible: product.isVisible,
      adminNotes: product.adminNotes,

      // Metadata
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    }));

    res.json({
      success: true,
      data: {
        category: {
          id: category.squareId,
          name: category.name,
          customName: category.customName,
        },
        products: transformedProducts,
        pagination: {
          total: products.count,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          pages: Math.ceil(products.count / parseInt(limit as string)),
        },
      },
    });
  } catch (error: any) {
    console.error("Error fetching category products:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch category products",
    });
  }
});

// POST /api/v1/admin/categories/:categoryId/products - Add products to category
router.post("/:categoryId/products", async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { productIds, isPrimary = false } = req.body;

    if (!productIds || !Array.isArray(productIds)) {
      return res.status(400).json({
        success: false,
        error: "productIds array is required",
      });
    }

    const category = await SquareCategory.findOne({
      where: { squareId: categoryId },
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Import sequelize for raw queries
    const { sequelize } = require("../../db/models/squareProduct");

    for (const productId of productIds) {
      try {
        // Check if product exists
        const product = await SquareProduct.findOne({
          where: { squareId: productId },
        });

        if (!product) {
          results.failed++;
          results.errors.push(`Product ${productId} not found`);
          continue;
        }

        // Add to product_categories table
        await sequelize.query(
          `INSERT INTO product_categories (product_square_id, category_square_id, is_primary)
           VALUES (:productId, :categoryId, :isPrimary)
           ON CONFLICT (product_square_id, category_square_id) 
           DO UPDATE SET is_primary = :isPrimary`,
          {
            replacements: {
              productId: productId,
              categoryId: categoryId,
              isPrimary: isPrimary,
            },
          }
        );

        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(
          `Failed to add product ${productId}: ${error.message}`
        );
      }
    }

    res.json({
      success: true,
      message: `Added products to category ${category.name}`,
      data: results,
    });
  } catch (error: any) {
    console.error("Error adding products to category:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to add products to category",
    });
  }
});

// DELETE /api/v1/admin/categories/:categoryId/products/:productId - Remove product from category
router.delete("/:categoryId/products/:productId", async (req, res) => {
  try {
    const { categoryId, productId } = req.params;

    // Import sequelize for raw queries
    const { sequelize } = require("../../db/models/squareProduct");

    const result = await sequelize.query(
      `DELETE FROM product_categories 
       WHERE product_square_id = :productId AND category_square_id = :categoryId`,
      {
        replacements: {
          productId: productId,
          categoryId: categoryId,
        },
      }
    );

    res.json({
      success: true,
      message: "Product removed from category successfully",
    });
  } catch (error: any) {
    console.error("Error removing product from category:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to remove product from category",
    });
  }
});

// PUT /api/v1/admin/categories/navigation/reorder - Reorder navigation categories
router.put("/navigation/reorder", async (req, res) => {
  try {
    const { orderedCategoryIds } = req.body;

    if (!orderedCategoryIds || !Array.isArray(orderedCategoryIds)) {
      return res.status(400).json({
        success: false,
        error: "Missing required field: orderedCategoryIds array",
      });
    }

    // Update featuredOrder for each category based on array position
    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < orderedCategoryIds.length; i++) {
      try {
        const categoryId = orderedCategoryIds[i];
        const category = await SquareCategory.findOne({
          where: { squareId: categoryId },
        });

        if (!category) {
          results.failed++;
          results.errors.push(`Category ${categoryId} not found`);
          continue;
        }

        await category.update({
          featuredOrder: i + 1,
          isFeatured: true, // Ensure it's featured since it's in navigation
        });

        results.success++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(
          `Failed to update ${orderedCategoryIds[i]}: ${error.message}`
        );
      }
    }

    res.json({
      success: true,
      message: `Reordered ${results.success} categories successfully`,
      results,
    });
  } catch (error: any) {
    console.error("Error reordering navigation categories:", error);
    res.status(500).json({
      success: false,
      error: "Failed to reorder navigation categories",
      details: error.message,
    });
  }
});

export default router;
