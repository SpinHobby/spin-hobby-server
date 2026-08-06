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

// GET /api/square/catalog?q=keyword&cursor=...
router.get("/square/catalog", async (req, res) => {
  try {
    const { q, cursor } = req.query;
    const result = await squareService.searchCatalog(
      q as string | undefined,
      cursor as string | undefined
    );
    sendJson(res, 200, { success: true, ...result });
  } catch (error: any) {
    console.error("Error searching Square catalog:", error);
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

// POST /api/square/payments  { sourceId, amount, currency? }
router.post("/square/payments", async (req, res) => {
  try {
    const { sourceId, amount, currency } = req.body;

    if (!sourceId || !amount) {
      return sendJson(res, 400, {
        success: false,
        error: "sourceId and amount are required",
      });
    }

    const payment = await squareService.createPayment({
      sourceId,
      amount,
      currency,
    });

    sendJson(res, 200, { success: true, payment });
  } catch (error: any) {
    console.error("Error creating Square payment:", error);
    const message =
      error?.errors?.[0]?.detail || error.message || "Payment failed";
    sendJson(res, 400, { success: false, error: message });
  }
});

export default router;
