import express from "express";
import { pool } from "../db/pool";
import { squareService } from "../services/square";
import { requireAdminAuth } from "./middleware/requireAdminAuth";

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

// GET /api/homepage - public, no auth. Hero slides + featured products,
// joined against live Square data so product info is never duplicated.
router.get("/homepage", async (req, res) => {
  try {
    const slidesResult = await pool.query(
      "SELECT id, headline, subheading, image_url AS \"imageUrl\" FROM homepage_hero_slides WHERE is_visible = true ORDER BY sort_order ASC"
    );
    const featuredResult = await pool.query(
      "SELECT square_item_id FROM featured_products WHERE is_visible = true ORDER BY sort_order ASC"
    );

    const featuredItems: any[] = [];
    const relatedObjects: any[] = [];
    for (const row of featuredResult.rows) {
      const { item, relatedObjects: related } = await squareService.getItem(
        row.square_item_id
      );
      if (item) {
        featuredItems.push(item);
        relatedObjects.push(...related);
      }
    }

    sendJson(res, 200, {
      success: true,
      slides: slidesResult.rows,
      featuredItems,
      relatedObjects,
    });
  } catch (error: any) {
    console.error("Error loading homepage content:", error);
    sendJson(res, 500, { success: false, error: error.message });
  }
});

// --- Admin: hero slides ---
// All /homepage/admin/* routes require the shared admin password (see
// requireAdminAuth) - previously gated client-side only.
router.use("/homepage/admin", requireAdminAuth);

router.get("/homepage/admin/slides", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM homepage_hero_slides ORDER BY sort_order ASC"
    );
    sendJson(res, 200, { success: true, slides: result.rows });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.post("/homepage/admin/slides", async (req, res) => {
  try {
    const { headline, subheading, imageUrl, sortOrder } = req.body;
    if (!headline) {
      return sendJson(res, 400, { success: false, error: "headline is required" });
    }
    const result = await pool.query(
      `INSERT INTO homepage_hero_slides (headline, subheading, image_url, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [headline, subheading || null, imageUrl || null, sortOrder || 0]
    );
    sendJson(res, 200, { success: true, slide: result.rows[0] });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.put("/homepage/admin/slides/:id", async (req, res) => {
  try {
    const { headline, subheading, imageUrl, sortOrder, isVisible } = req.body;
    const result = await pool.query(
      `UPDATE homepage_hero_slides SET
        headline = COALESCE($1, headline),
        subheading = $2,
        image_url = $3,
        sort_order = COALESCE($4, sort_order),
        is_visible = COALESCE($5, is_visible)
      WHERE id = $6 RETURNING *`,
      [headline, subheading, imageUrl, sortOrder, isVisible, req.params.id]
    );
    if (result.rows.length === 0) {
      return sendJson(res, 404, { success: false, error: "Slide not found" });
    }
    sendJson(res, 200, { success: true, slide: result.rows[0] });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.delete("/homepage/admin/slides/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM homepage_hero_slides WHERE id = $1", [
      req.params.id,
    ]);
    sendJson(res, 200, { success: true });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

// --- Admin: featured products ---

router.get("/homepage/admin/featured", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM featured_products ORDER BY sort_order ASC"
    );
    // Enrich with live Square data so the admin UI can show a name/image,
    // not just a bare item id.
    const enriched = await Promise.all(
      result.rows.map(async (row) => {
        const { item } = await squareService.getItem(row.square_item_id);
        return { ...row, name: (item as any)?.itemData?.name || "(item not found in Square)" };
      })
    );
    sendJson(res, 200, { success: true, featured: enriched });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.post("/homepage/admin/featured", async (req, res) => {
  try {
    const { squareItemId, sortOrder } = req.body;
    if (!squareItemId) {
      return sendJson(res, 400, { success: false, error: "squareItemId is required" });
    }
    const result = await pool.query(
      `INSERT INTO featured_products (square_item_id, sort_order)
       VALUES ($1, $2)
       ON CONFLICT (square_item_id)
       DO UPDATE SET sort_order = EXCLUDED.sort_order, is_visible = true
       RETURNING *`,
      [squareItemId, sortOrder || 0]
    );
    sendJson(res, 200, { success: true, featured: result.rows[0] });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.put("/homepage/admin/featured/:id", async (req, res) => {
  try {
    const { sortOrder, isVisible } = req.body;
    const result = await pool.query(
      `UPDATE featured_products SET
        sort_order = COALESCE($1, sort_order),
        is_visible = COALESCE($2, is_visible)
      WHERE id = $3 RETURNING *`,
      [sortOrder, isVisible, req.params.id]
    );
    if (result.rows.length === 0) {
      return sendJson(res, 404, { success: false, error: "Not found" });
    }
    sendJson(res, 200, { success: true, featured: result.rows[0] });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

router.delete("/homepage/admin/featured/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM featured_products WHERE id = $1", [
      req.params.id,
    ]);
    sendJson(res, 200, { success: true });
  } catch (error: any) {
    sendJson(res, 500, { success: false, error: error.message });
  }
});

export default router;
