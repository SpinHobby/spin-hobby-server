import express from "express";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import { squareService } from "../services/square";

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
  },
  required: ["title", "description"],
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

    const response = await anthropic.messages.create({
      model: "claude-opus-5",
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
              text: "This is a photo of anime/hobby merchandise being catalogued by a cashier at a convention booth. Identify the item (character, series if recognizable, item type such as figure/keychain/plush/badge/shirt) and write a short title and description for it. If you can't identify the specific character or series, describe what's visible instead of guessing.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from model");
    }

    const result = JSON.parse(textBlock.text);
    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    console.error("Error identifying item:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/cashier/record  multipart: photo (optional), title, description, price (price in dollars)
router.post("/cashier/record", upload.single("photo"), async (req, res) => {
  try {
    const { title, description, price } = req.body;
    const file = req.file;

    if (!title || price == null) {
      return res.status(400).json({ success: false, error: "title and price are required" });
    }
    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      return res.status(400).json({ success: false, error: "price must be a positive number" });
    }

    const item = await squareService.createLocationItem({
      name: title,
      description,
      price: priceCents,
      photo: file ? { buffer: file.buffer, mimetype: file.mimetype } : undefined,
    });

    res.status(200).json({ success: true, itemId: item?.id });
  } catch (error: any) {
    console.error("Error recording item to Square:", error);
    const message = error?.errors?.[0]?.detail || error.message || "Failed to save item";
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
