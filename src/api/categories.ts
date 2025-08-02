import express from "express";
import { SquareCategory, SquareProduct } from "../db/models/initModels";
import { Op } from "sequelize";

const router = express.Router();

// GET /api/v1/categories - Get all categories with admin controls
router.get("/v1/categories", async (req, res) => {
  try {
    const {
      featured_only = false,
      include_hidden = false,
      parent_only = false,
    } = req.query;

    const whereClause: any = {
      isDeleted: false,
    };

    // Filter by visibility unless specifically including hidden
    if (!include_hidden) {
      whereClause.isVisible = true;
    }

    // Filter by featured status if requested
    if (featured_only === "true") {
      whereClause.isFeatured = true;
    }

    // Filter to only parent categories if requested
    if (parent_only === "true") {
      whereClause.squareParentCategoryId = null;
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
          where: { isVisible: true, isDeleted: false },
          required: false,
        },
      ],
    });

    // Transform to match frontend expectations
    const transformedCategories = categories.map((category) => ({
      id: category.squareId,
      name: category.customName || category.name,
      description:
        category.customDescription || `Browse our ${category.name} collection`,
      img: "https://i.redd.it/9lrjb3sqzmq41.jpg", // Default anime image
      productCount: 0, // Will be populated by product count query
      featured: category.isFeatured,
      parentCategoryId: category.squareParentCategoryId,
      subcategories:
        category.subcategories?.map((sub) => ({
          id: sub.squareId,
          name: sub.customName || sub.name,
          description: sub.customDescription,
          featured: sub.isFeatured,
        })) || [],
    }));

    // Get product counts for each category
    for (const category of transformedCategories) {
      const productCount = await SquareProduct.count({
        include: [
          {
            model: SquareCategory,
            as: "SquareCategories", // Specify the many-to-many association alias
            where: { squareId: category.id },
            through: { attributes: [] },
          },
        ],
        where: {
          isVisible: true,
          isDeleted: false,
        },
      });
      category.productCount = productCount;
    }

    res.json({
      success: true,
      data: transformedCategories,
      meta: {
        total: transformedCategories.length,
        featured: transformedCategories.filter((cat) => cat.featured).length,
        hasRealData: true,
        dataSource: "database",
      },
    });
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch categories",
    });
  }
});

// GET /api/v1/categories/:identifier - Get specific category by ID or name
router.get("/v1/categories/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;

    // Try to find by Square ID first, then by name
    const category = await SquareCategory.findOne({
      where: {
        [Op.or]: [
          { squareId: identifier },
          { name: { [Op.iLike]: identifier } },
          { customName: { [Op.iLike]: identifier } },
        ],
        isDeleted: false,
        isVisible: true,
      },
      include: [
        {
          model: SquareCategory,
          as: "subcategories",
          where: { isVisible: true, isDeleted: false },
          required: false,
        },
      ],
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: "Category not found",
      });
    }

    // Get products in this category
    const products = await SquareProduct.findAll({
      include: [
        {
          model: SquareCategory,
          as: "SquareCategories",
          where: { squareId: category.squareId },
          through: { attributes: [] },
        },
      ],
      where: {
        isVisible: true,
        isDeleted: false,
      },
      limit: 20,
      order: [
        ["isFeatured", "DESC"],
        ["createdAt", "DESC"],
      ],
    });

    const transformedCategory = {
      id: category.squareId,
      name: category.customName || category.name,
      description: category.customDescription || category.description,
      img: "https://i.redd.it/9lrjb3sqzmq41.jpg",
      productCount: products.length,
      featured: category.isFeatured,
      parentCategoryId: category.squareParentCategoryId,
      subcategories:
        category.subcategories?.map((sub) => ({
          id: sub.squareId,
          name: sub.customName || sub.name,
          description: sub.customDescription,
          featured: sub.isFeatured,
        })) || [],
      products: products.map((product) => ({
        id: product.squareId,
        name: product.name,
        description: product.customDescription || product.description,
        price: product.customPrice || 0,
        images: JSON.parse(product.images || "[]"),
        isFeatured: product.isFeatured,
        tags: product.adminNotes ? product.adminNotes.split(" | ") : [],
      })),
    };

    res.json({
      success: true,
      data: transformedCategory,
    });
  } catch (error: any) {
    console.error("Error fetching category:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch category",
    });
  }
});

export default router;
