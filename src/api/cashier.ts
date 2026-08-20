import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { squareService, CASHIER_CATEGORY_ID } from "../services/square";
import { PRODUCT_CATEGORIES } from "../services/productCategories";
import { cropToArtworkRegion } from "../services/imageProcessing";
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
    artworkCrop: {
      type: "object",
      description:
        "Only include this when the photo is of a SEALED box: the bounding box of the printed product photo/artwork panel on the box face, with a small margin so the full panel is included even if photographed at a slight angle. Coordinates are fractions (0-1) of the full photo's width/height, measured from the top-left corner. Omit entirely if the photo isn't a sealed box, or if no clear artwork panel is visible.",
      properties: {
        x: { type: "number", description: "Left edge, as a fraction of image width (0-1)." },
        y: { type: "number", description: "Top edge, as a fraction of image height (0-1)." },
        width: { type: "number", description: "Width, as a fraction of image width (0-1)." },
        height: { type: "number", description: "Height, as a fraction of image height (0-1)." },
        rotationDegrees: {
          type: "number",
          description:
            "Degrees to rotate the cropped region clockwise to make the artwork's edges level/straight, between -45 and 45. 0 if it's already straight.",
        },
      },
      required: ["x", "y", "width", "height", "rotationDegrees"],
      additionalProperties: false,
    },
  },
  required: ["title", "description", "category"],
  additionalProperties: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Validates + clamps the model's artworkCrop into a safe, always-in-bounds
// box before it's ever used to crop a real image - a model-returned
// coordinate slightly outside [0,1] or a nonsensical width/height must never
// crash or corrupt the save.
function sanitizeArtworkCrop(raw: any): {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDegrees: number;
} | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const x = clamp(Number(raw.x), 0, 0.95);
  const y = clamp(Number(raw.y), 0, 0.95);
  const width = clamp(Number(raw.width), 0.05, 1 - x);
  const height = clamp(Number(raw.height), 0.05, 1 - y);
  const rotationDegrees = clamp(Number(raw.rotationDegrees) || 0, -45, 45);
  if (![x, y, width, height, rotationDegrees].every(Number.isFinite)) return undefined;
  return { x, y, width, height, rotationDegrees };
}

router.post("/cashier/identify", upload.single("photo"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, error: "photo is required" });
    }
    if (!file.mimetype.startsWith("image/")) {
      return res.status(400).json({ success: false, error: "file must be an image" });
    }
    const isSealed = req.body.condition === "sealed";

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
              )}. If you can't identify the specific character or series, describe what's visible instead of guessing. If nothing fits well, use "Other".\n\n${
                isSealed
                  ? "This item is SEALED in its box. Also locate the printed product photo/artwork panel on the box's face and return it as `artworkCrop`, so it can be cropped out and used as the product photo - this is the manufacturer's own professional photo of the figure, already on the packaging. Include a small margin around the panel and estimate any rotation needed to straighten it."
                  : "This item is not sealed (the actual product is what's photographed) - omit `artworkCrop` entirely."
              }`,
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
    const artworkCrop = sanitizeArtworkCrop(result.artworkCrop);
    res.status(200).json({
      success: true,
      title: result.title,
      description: result.description,
      category: result.category,
      artworkCrop,
    });
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

    let photoBuffer = file?.buffer;
    const artworkCrop = sanitizeArtworkCrop({
      x: req.body.artworkCropX,
      y: req.body.artworkCropY,
      width: req.body.artworkCropWidth,
      height: req.body.artworkCropHeight,
      rotationDegrees: req.body.artworkRotationDegrees,
    });
    if (photoBuffer && artworkCrop) {
      photoBuffer = await cropToArtworkRegion(photoBuffer, artworkCrop);
    }

    const item = await squareService.createLocationItem({
      name: title,
      description: fullDescription,
      price: priceCents,
      photo: photoBuffer && file ? { buffer: photoBuffer, mimetype: file.mimetype } : undefined,
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
    const { q, cursor } = req.query;
    const result = await squareService.searchAllItems(
      (q as string) || undefined,
      (cursor as string) || undefined,
      30
    );
    const imagesById = new Map<string, string>();
    (result.relatedObjects as any[]).forEach((obj) => {
      if (obj.type === "IMAGE" && obj.imageData?.url) {
        imagesById.set(obj.id, obj.imageData.url);
      }
    });
    res.status(200).json({
      success: true,
      cursor: result.cursor,
      items: (result.items as any[]).map((item) => {
        const imageId = item.itemData?.imageIds?.[0];
        return {
          id: item.id,
          name: item.itemData?.name,
          priceCents: Number(
            item.itemData?.variations?.[0]?.itemVariationData?.priceMoney?.amount ?? 0
          ),
          hidden: (item.itemData?.categories || []).some(
            (c: any) => c.id === CASHIER_CATEGORY_ID
          ),
          imageUrl: imageId ? imagesById.get(imageId) : undefined,
        };
      }),
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
