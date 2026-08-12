import express from "express";
import { pool } from "../db/pool";
import { squareService } from "../services/square";
import { requireCustomerAuth } from "./middleware/requireCustomerAuth";

const router = express.Router();

function sendJson(res: express.Response, status: number, data: unknown) {
  res
    .status(status)
    .type("application/json")
    .send(JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? Number(value) : value)));
}

// GET /api/wishlist - hydrates each stored item id with live Square data
// (price/stock/image), unlike orders which snapshot at purchase time.
router.get("/wishlist", requireCustomerAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT square_item_id FROM wishlist_items WHERE customer_id = $1 ORDER BY created_at DESC",
      [req.customer!.id]
    );

    const items: any[] = [];
    const relatedObjects: any[] = [];
    for (const row of result.rows) {
      const { item, relatedObjects: related } = await squareService.getItem(row.square_item_id);
      if (item) {
        items.push(item);
        relatedObjects.push(...related);
      }
    }

    sendJson(res, 200, { success: true, items, relatedObjects });
  } catch (error: any) {
    console.error("Error fetching wishlist:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.post("/wishlist", requireCustomerAuth, async (req, res) => {
  try {
    const { squareItemId } = req.body;
    if (!squareItemId) {
      return sendJson(res, 400, { success: false, error: "squareItemId is required" });
    }
    await pool.query(
      `INSERT INTO wishlist_items (customer_id, square_item_id)
       VALUES ($1, $2)
       ON CONFLICT (customer_id, square_item_id) DO NOTHING`,
      [req.customer!.id, squareItemId]
    );
    sendJson(res, 200, { success: true });
  } catch (error: any) {
    console.error("Error adding to wishlist:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.delete("/wishlist/:squareItemId", requireCustomerAuth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM wishlist_items WHERE customer_id = $1 AND square_item_id = $2",
      [req.customer!.id, req.params.squareItemId]
    );
    sendJson(res, 200, { success: true });
  } catch (error: any) {
    console.error("Error removing from wishlist:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

export default router;
