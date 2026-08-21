import express from "express";
import { pool } from "../db/pool";
import { requireAdminAuth } from "./middleware/requireAdminAuth";

const router = express.Router();

// GET /api/events - public, no auth. Visible events for the storefront page.
router.get("/events", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, date_label AS "dateLabel", title, location, link
       FROM events WHERE is_visible = true ORDER BY sort_order ASC`
    );
    res.status(200).json({ success: true, events: result.rows });
  } catch (error: any) {
    console.error("Error loading events:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Admin: full CRUD, including hidden events ---
router.use("/events/admin", requireAdminAuth);

router.get("/events/admin", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM events ORDER BY sort_order ASC");
    res.status(200).json({ success: true, events: result.rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/events/admin", async (req, res) => {
  try {
    const { dateLabel, title, location, link, sortOrder } = req.body;
    if (!dateLabel || !title || !location) {
      return res
        .status(400)
        .json({ success: false, error: "dateLabel, title, and location are required" });
    }
    const result = await pool.query(
      `INSERT INTO events (date_label, title, location, link, sort_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dateLabel, title, location, link || null, sortOrder || 0]
    );
    res.status(200).json({ success: true, event: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/events/admin/:id", async (req, res) => {
  try {
    const { dateLabel, title, location, link, sortOrder, isVisible } = req.body;
    const result = await pool.query(
      `UPDATE events SET
        date_label = COALESCE($1, date_label),
        title = COALESCE($2, title),
        location = COALESCE($3, location),
        link = $4,
        sort_order = COALESCE($5, sort_order),
        is_visible = COALESCE($6, is_visible)
      WHERE id = $7 RETURNING *`,
      [dateLabel, title, location, link, sortOrder, isVisible, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Event not found" });
    }
    res.status(200).json({ success: true, event: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete("/events/admin/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM events WHERE id = $1", [req.params.id]);
    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
