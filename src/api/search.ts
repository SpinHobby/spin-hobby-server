import express from "express";
import { SquareProduct, SquareCategory } from "../db/models/initModels";
import { SquareService } from "../services/square";
import { Op } from "sequelize";

const router = express.Router();
const squareService = new SquareService();

/**
 * SEARCH API ENDPOINTS
 * Searches products from both local database and Square catalog
 */

// GET /api/v1/search - Main search endpoint
router.get("/v1/search", async (req, res) => {
  try {
    const {
      q: query,
      category,
      page = 1,
      limit = 20,
      source = "all", // "all", "database", "square"
    } = req.query;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    const searchQuery = query.trim();
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let databaseResults: any[] = [];
    let squareResults: any[] = [];
    let totalCount = 0;

    // Search local database
    if (source === "all" || source === "database") {
      const whereClause: any = {
        isVisible: true,
        isDeleted: false,
        [Op.or]: [
          { name: { [Op.iLike]: `%${searchQuery}%` } },
          { description: { [Op.iLike]: `%${searchQuery}%` } },
          { customDescription: { [Op.iLike]: `%${searchQuery}%` } },
          { adminNotes: { [Op.iLike]: `%${searchQuery}%` } },
        ],
      };

      // Add category filter if specified
      if (category && category !== "All Categories") {
        const categoryRecord = await SquareCategory.findOne({
          where: {
            [Op.or]: [
              { name: { [Op.iLike]: `%${category}%` } },
              { customName: { [Op.iLike]: `%${category}%` } },
            ],
          },
        });

        if (categoryRecord) {
          whereClause.squareCategoryId = categoryRecord.squareId;
        }
      }

      const dbQuery = await SquareProduct.findAndCountAll({
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
        limit: limitNum,
        offset: offset,
        order: [
          ["isFeatured", "DESC"],
          ["createdAt", "DESC"],
        ],
      });

      databaseResults = dbQuery.rows.map((product) => ({
        id: product.squareId,
        title: product.name,
        name: product.name,
        description: product.customDescription || product.description,
        price: product.customPrice || product.variations?.[0]?.price || 0,
        images: product.images || [],
        variations: product.variations || [],
        categories:
          (product as any).SquareCategories?.map((cat: any) => ({
            id: cat.squareId,
            name: cat.customName || cat.name,
          })) || [],
        isFeatured: product.isFeatured,
        isNewArrival: product.adminNotes?.includes("NEW ARRIVAL") || false,
        isPreorder: product.adminNotes?.includes("PREORDER ITEM") || false,
        source: "database",
      }));

      totalCount = dbQuery.count;
    }

    // Search Square catalog if needed
    if (source === "all" || source === "square") {
      try {
        // Get category IDs for Square search if category filter is applied
        let categoryIds: string[] = [];
        if (category && category !== "All Categories") {
          const categoryRecord = await SquareCategory.findOne({
            where: {
              [Op.or]: [
                { name: { [Op.iLike]: `%${category}%` } },
                { customName: { [Op.iLike]: `%${category}%` } },
              ],
            },
          });

          if (categoryRecord) {
            categoryIds = [categoryRecord.squareId];
          }
        }

        const squareSearchResults = await squareService.searchProducts(
          searchQuery,
          categoryIds.length > 0 ? categoryIds : undefined
        );

        squareResults = squareSearchResults.map((product: any) => ({
          id: product.id,
          title: product.name,
          name: product.name,
          description: product.description || "",
          price: product.price || 0,
          images: product.images || [],
          variations: product.variations || [],
          categories: product.categories || [],
          source: "square",
        }));
      } catch (error) {
        console.warn(
          "Square search failed, continuing with database results only:",
          error
        );
      }
    }

    // Combine and deduplicate results (prefer database over Square)
    const combinedResults = [...databaseResults];
    const existingIds = new Set(databaseResults.map((item) => item.id));

    squareResults.forEach((squareItem) => {
      if (!existingIds.has(squareItem.id)) {
        combinedResults.push(squareItem);
      }
    });

    // Apply pagination to combined results
    const finalResults = combinedResults.slice(0, limitNum);

    res.json({
      success: true,
      data: finalResults,
      meta: {
        query: searchQuery,
        category: category || "All Categories",
        page: pageNum,
        limit: limitNum,
        total: Math.max(totalCount, combinedResults.length),
        found: finalResults.length,
        sources: {
          database: databaseResults.length,
          square: squareResults.length,
        },
      },
    });
  } catch (error: any) {
    console.error("Search error:", error);
    res.status(500).json({
      success: false,
      error: "Search failed",
      details: error.message,
    });
  }
});

// GET /api/v1/search/suggestions - Get search suggestions
router.get("/v1/search/suggestions", async (req, res) => {
  try {
    const { q: query, limit = 5 } = req.query;

    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return res.json({
        success: true,
        suggestions: [],
      });
    }

    const searchQuery = query.trim();
    const limitNum = parseInt(limit as string);

    // Get product name suggestions from database
    const products = await SquareProduct.findAll({
      where: {
        isVisible: true,
        isDeleted: false,
        name: { [Op.iLike]: `%${searchQuery}%` },
      },
      attributes: ["name"],
      limit: limitNum,
      order: [["isFeatured", "DESC"]],
    });

    // Get category suggestions
    const categories = await SquareCategory.findAll({
      where: {
        isVisible: true,
        isDeleted: false,
        [Op.or]: [
          { name: { [Op.iLike]: `%${searchQuery}%` } },
          { customName: { [Op.iLike]: `%${searchQuery}%` } },
        ],
      },
      attributes: ["name", "customName"],
      limit: Math.ceil(limitNum / 2),
    });

    const suggestions = [
      ...products.map((p) => ({
        text: p.name,
        type: "product",
      })),
      ...categories.map((c) => ({
        text: c.customName || c.name,
        type: "category",
      })),
    ].slice(0, limitNum);

    res.json({
      success: true,
      suggestions,
    });
  } catch (error: any) {
    console.error("Search suggestions error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get search suggestions",
    });
  }
});

export default router;
