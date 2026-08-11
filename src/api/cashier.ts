import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { squareService, CASHIER_CATEGORY_ID } from "../services/square";
import { PRODUCT_CATEGORIES } from "../services/productCategories";
import { estimateAnthropicCost, recordAiUsage, getBudgetStatus } from "../services/aiUsage";

const AI_TOOL = "anthropic_cashier";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const anthropic = new Anthropic();

const IDENTIFY_SCHEMA = {
  type: "object" as const,
  properties: {
    title: {
      type: "string",
      description:
        "A short, customer-facing product title (character/series name + item type, e.g. 'Tanjiro Kamado Figure').",
    },
    description: {
      type: "string",
      description: "A 1-2 sentence description of the item for a price tag or receipt.",
    },
    category: {
      type: "string",
      enum: PRODUCT_CATEGORIES,
      description: "The single best-fitting product category for this item.",
    },
  },
  required: ["title", "description", "category"],
  additionalProperties: false,
};

router.post("/cashier/identify", upload.single("photo"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "photo is required" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({ success: false, error: "file must be an image" });
    }

    const budget = await getBudgetStatus(AI_TOOL);
    if (budget.status === "blocked") {
      return res.status(429).json({
        success: false,
        error: `Photo identification is disabled for the rest of the month - AI budget of $${budget.stopThresholdUsd} reached. Enter the title/description manually, or ask an admin to raise the budget in the Ops dashboard.`,
      });
    }

    const model = "claude-opus-5";
    const response = await anthropic.messages.create({
      model,
      max_tokens: 512,
      output_config: { format: { type: "json_schema", schema: IDENTIFY_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: file.mimetype as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: file.buffer.toString("base64"),
              },
            },
            {
              type: "text",
              text: `This is a photo of anime/hobby merchandise being catalogued by a cashier, either at a convention booth or for the online store. Identify the item (character, series if recognizable, item type such as figure/keychain/plush/badge/shirt), write a short title and description for it, and classify it into exactly one of these categories: ${PRODUCT_CATEGORIES.join(
                ", "
              )}. If you can't identify the specific character or series, describe what's visible instead of guessing. If nothing fits well, use "Other".`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from model");
    }

    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens;
    const cost = estimateAnthropicCost(model, inputTokens, outputTokens);
    recordAiUsage(AI_TOOL, cost, inputTokens, outputTokens).catch((error) =>
      console.error("Error recording AI usage:", error)
    );

    const result = JSON.parse(textBlock.text);
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error("Error identifying item:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/cashier/record  multipart: photo (optional), title, description,
// price (dollars), hidden ("true"/"false"), quantity (only used when hidden
// is false - the initial stock count to set for the new variation)
router.post("/cashier/record", upload.single("photo"), async (req, res) => {
  try {
    const { title, description, price, hidden, quantity, category, condition } = req.body;
    const file = req.file;

    if (!title || price == null) {
      return res.status(400).json({ success: false, error: "title and price are required" });
    }
    const conditionLabel =
      condition === "sealed" ? "Sealed / New in box" : condition === "used" ? "Opened / Used" : null;
    const fullDescription = conditionLabel
      ? [description, `Condition: ${conditionLabel}`].filter(Boolean).join("\n\n")
      : description;
    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return res.status(400).json({ success: false, error: "price must be a positive number" });
    }
    const isHidden = hidden !== "false";
    let quantityValue: number | undefined;
    if (!isHidden) {
      quantityValue = Number(quantity);
      if (!Number.isFinite(quantityValue) || quantityValue < 0) {
        return res
          .status(400)
          .json({ success: false, error: "quantity must be a non-negative number" });
      }
    }

    let categoryId: string | undefined;
    if (category) {
      try {
        categoryId = await squareService.getOrCreateCategoryId(category);
      } catch (error) {
        console.error("Error resolving category, saving without one:", error);
      }
    }

    const item = await squareService.createLocationItem({
      name: title,
      description: fullDescription,
      price: priceCents,
      photo: file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
      hidden: isHidden,
      categoryId,
    });

    const variationId = item?.item_data?.variations?.[0]?.id;
    if (!isHidden && variationId && quantityValue != null) {
      try {
        await squareService.setInitialInventoryCount(variationId, quantityValue);
      } catch (error) {
        console.error("Error setting initial inventory count:", error);
      }
    }

    res.status(200).json({ success: true, itemId: item?.id });
  } catch (error: any) {
    console.error("Error recording item to Square:", error);
    const message = error?.errors?.[0]?.detail || error.message || "Failed to save item";
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/cashier/search?q=... - unfiltered item search (includes hidden
// convention items) for the "Edit Existing" picker.
router.get("/cashier/search", async (req, res) => {
  try {
    const { q } = req.query;
    const result = await squareService.searchAllItems(q as string | undefined, undefined, 20);
    res.status(200).json({
      success: true,
      items: (result.items as any[]).map((item) => ({
        id: item.id,
        name: item.itemData?.name,
        priceCents: Number(
          item.itemData?.variations?.[0]?.itemVariationData?.priceMoney?.amount ?? 0
        ),
        hidden: (item.itemData?.categories || []).some(
          (c: any) => c.id === CASHIER_CATEGORY_ID
        ),
      })),
    });
  } catch (error: any) {
    console.error("Error searching items:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/cashier/item/:id - fetch an existing item's editable fields for
// the "Edit Existing" flow in the cashier tool.
router.get("/cashier/item/:id", async (req, res) => {
  try {
    const { item } = await squareService.getItem(req.params.id);
    if (!item || item.type !== "ITEM") {
      return res.status(404).json({ success: false, error: "Item not found" });
    }
    const variation = item.itemData?.variations?.[0];
    const variationId =
      variation && variation.type === "ITEM_VARIATION" ? variation.id : undefined;
    const priceCents =
      variation && variation.type === "ITEM_VARIATION"
        ? Number(variation.itemVariationData?.priceMoney?.amount ?? 0)
        : 0;

    const categories = item.itemData?.categories || [];
    const hidden = categories.some((c) => c.id === CASHIER_CATEGORY_ID);
    const categoryId = categories.find((c) => c.id !== CASHIER_CATEGORY_ID)?.id;

    let categoryName: string | undefined;
    if (categoryId) {
      const allCategories = await squareService.listCategories();
      categoryName = (allCategories as any[]).find((c) => c.id === categoryId)?.categoryData
        ?.name;
    }

    let stockCount: number | null = null;
    if (variationId) {
      const counts = await squareService.getInventoryCounts([variationId]);
      stockCount = variationId in counts ? counts[variationId] : null;
    }

    res.status(200).json({
      success: true,
      item: {
        id: item.id,
        name: item.itemData?.name,
        description: item.itemData?.description,
        priceCents,
        variationId,
        categoryId,
        categoryName,
        hidden,
        stockCount,
      },
    });
  } catch (error: any) {
    console.error("Error fetching item for edit:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/cashier/item/:id  multipart: title, description, price, hidden,
// category, quantity (optional new photo). Updates an existing item in place.
router.put("/cashier/item/:id", upload.single("photo"), async (req, res) => {
  try {
    const { title, description, price, hidden, quantity, category, categoryId: rawCategoryId } =
      req.body;
    const file = req.file;

    if (!title || price == null) {
      return res.status(400).json({ success: false, error: "title and price are required" });
    }
    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return res.status(400).json({ success: false, error: "price must be a positive number" });
    }
    const isHidden = hidden !== "false";

    // `category` (a name from our canonical list) takes priority; falls back
    // to `categoryId` (the item's existing raw category id, passed through
    // unresolved by the edit form when the item's current category isn't one
    // of ours) so editing other fields doesn't silently clear it.
    let categoryId: string | undefined;
    if (category) {
      try {
        categoryId = await squareService.getOrCreateCategoryId(category);
      } catch (error) {
        console.error("Error resolving category, saving without one:", error);
      }
    } else if (rawCategoryId) {
      categoryId = rawCategoryId;
    }

    const item = await squareService.updateLocationItem({
      itemId: String(req.params.id),
      name: title,
      description,
      price: priceCents,
      hidden: isHidden,
      categoryId,
      photo: file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
    });

    if (!isHidden && quantity != null && quantity !== "") {
      const quantityValue = Number(quantity);
      const variation = item?.item_data?.variations?.[0];
      const variationId = variation?.id;
      if (variationId && Number.isFinite(quantityValue) && quantityValue >= 0) {
        try {
          await squareService.setInitialInventoryCount(variationId, quantityValue);
        } catch (error) {
          console.error("Error updating inventory count:", error);
        }
      }
    }

    res.status(200).json({ success: true, itemId: item?.id });
  } catch (error: any) {
    console.error("Error updating item:", error);
    const message = error?.errors?.[0]?.detail || error.message || "Failed to update item";
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
