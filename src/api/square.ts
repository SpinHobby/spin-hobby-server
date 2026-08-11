import express from "express";
import { squareService } from "../services/square";

const router = express.Router();

// Square's SDK represents money amounts as BigInt, which JSON.stringify can't
// serialize on its own. Only applied to our own outgoing responses.
function sendJson(res: express.Response, status: number, data: unknown) {
  res
    .status(status)
    .type("application/json")
    .send(
      JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? Number(value) : value
      )
    );
}

// GET /api/square/catalog?q=keyword&cursor=...&limit=24
router.get("/square/catalog", async (req, res) => {
  try {
    const { q, cursor, limit } = req.query;
    const result = await squareService.searchCatalog(
      q as string | undefined,
      cursor as string | undefined,
      limit ? parseInt(limit as string) : undefined
    );
    sendJson(res, 200, { success: true, ...result });
  } catch (error: any) {
    console.error("Error searching Square catalog:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

// GET /api/square/catalog/:id
router.get("/square/catalog/:id", async (req, res) => {
  try {
    const result = await squareService.getItem(req.params.id);
    if (!result.item) {
      return sendJson(res, 404, { success: false, error: "Item not found" });
    }
    sendJson(res, 200, { success: true, ...result });
  } catch (error: any) {
    console.error("Error fetching Square catalog item:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

// GET /api/square/categories
router.get("/square/categories", async (req, res) => {
  try {
    const categories = await squareService.listCategories();
    sendJson(res, 200, { success: true, categories });
  } catch (error: any) {
    console.error("Error fetching Square categories:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

// GET /api/square/locations
router.get("/square/locations", async (req, res) => {
  try {
    const locations = await squareService.listLocations();
    sendJson(res, 200, { success: true, locations });
  } catch (error: any) {
    console.error("Error fetching Square locations:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

// GET /api/square/config - public-safe values the frontend needs for the Web Payments SDK
router.get("/square/config", (req, res) => {
  sendJson(res, 200, { success: true, ...squareService.getConfig() });
});

// POST /api/square/payments  { sourceId, amount, currency?, items?: { variationId, quantity }[] }
router.post("/square/payments", async (req, res) => {
  try {
    const { sourceId, amount, currency, items } = req.body;

    if (!sourceId || !amount) {
      return sendJson(res, 400, {
        success: false,
        error: "sourceId and amount are required",
      });
    }

    // Pre-charge stock guard: reject before touching the card if a tracked
    // item no longer has enough stock. Untracked variations (missing from
    // the counts map) are treated as unlimited.
    if (Array.isArray(items) && items.length > 0) {
      const counts = await squareService.getInventoryCounts(
        items.map((i: any) => i.variationId).filter(Boolean)
      );
      for (const item of items) {
        const available = counts[item.variationId];
        if (available !== undefined && available < item.quantity) {
          return sendJson(res, 400, {
            success: false,
            error: "One or more items in your cart are no longer in stock.",
          });
        }
      }
    }

    const payment = await squareService.createPayment({
      sourceId,
      amount,
      currency,
    });

    // Best-effort: the card has already been charged, so an inventory-sync
    // failure here shouldn't fail the response - log it and move on.
    if (Array.isArray(items) && items.length > 0 && payment?.id) {
      try {
        await squareService.recordSaleInventoryChanges(
          items,
          `inv-${payment.id}`
        );
      } catch (error) {
        console.error("Error recording sale inventory changes:", error);
      }
    }

    sendJson(res, 200, { success: true, payment });
  } catch (error: any) {
    console.error("Error creating Square payment:", error);
    const message =
      error?.errors?.[0]?.detail || error.message || "Payment failed";
    sendJson(res, 400, { success: false, error: message });
  }
});

// GET /api/square/inventory?ids=variationId1,variationId2,...
router.get("/square/inventory", async (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const quantities = await squareService.getInventoryCounts(ids);
    sendJson(res, 200, { success: true, quantities });
  } catch (error: any) {
    console.error("Error fetching Square inventory:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

export default router;
