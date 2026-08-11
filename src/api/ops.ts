import express from "express";
import { pool } from "../db/pool";

const router = express.Router();

// Admin-only gauges. No server-side auth on this route (same pattern as the
// homepage admin routes) - the frontend gates it behind the shared admin
// password screen.
router.get("/ops/database", async (req, res) => {
  try {
    const sizeResult = await pool.query(
      "SELECT pg_database_size(current_database()) AS bytes"
    );
    const totalBytes = Number(sizeResult.rows[0].bytes);

    const tablesResult = await pool.query(`
      SELECT
        relname AS table_name,
        pg_total_relation_size(relid) AS bytes,
        n_live_tup AS row_estimate
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 10
    `);

    res.status(200).json({
      success: true,
      totalBytes,
      tables: tablesResult.rows.map((row) => ({
        name: row.table_name,
        bytes: Number(row.bytes),
        rowEstimate: Number(row.row_estimate),
      })),
    });
  } catch (error: any) {
    console.error("Error fetching database size:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
