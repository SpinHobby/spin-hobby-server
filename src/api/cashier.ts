import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { squareService } from "../services/square";
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

export default router;
