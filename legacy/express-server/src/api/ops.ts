import express from "express";
import { pool } from "../db/pool";
import { getBudgetStatus } from "../services/aiUsage";
import { requireAdminAuth } from "./middleware/requireAdminAuth";

const router = express.Router();

// Every route in this file is admin-only (ops dashboard) - previously
// gated client-side only, see requireAdminAuth. Must be scoped to "/ops" -
// this router is mounted at "/" alongside every other route file in
// api/index.ts, so an unscoped router.use() here would silently 401 every
// route registered after it in that file (auth, wishlist, account, events),
// not just this file's own routes. (Found and fixed live - this had broken
// Google/Discord login, wishlist, and account endpoints in production.)
router.use("/ops", requireAdminAuth);

// Tools tracked on the ops dashboard. Add an entry here (and a matching row
// in ai_budgets, or let it fall back to the $20/$30 defaults) whenever a new
// AI API is wired in - e.g. a photo-enhancement provider later.
const TRACKED_AI_TOOLS = ["anthropic_cashier"];

router.get("/ops/ai-usage", async (req, res) => {
  try {
    const statuses = await Promise.all(TRACKED_AI_TOOLS.map((tool) => getBudgetStatus(tool)));
    res.status(200).json({ success: true, tools: statuses });
  } catch (error: any) {
    console.error("Error fetching AI usage:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/ops/ai-usage/:tool", async (req, res) => {
  try {
    const { tool } = req.params;
    const { warnThresholdUsd, stopThresholdUsd } = req.body;
    if (
      !Number.isFinite(Number(warnThresholdUsd)) ||
      !Number.isFinite(Number(stopThresholdUsd)) ||
      Number(warnThresholdUsd) < 0 ||
      Number(stopThresholdUsd) < 0
    ) {
      return res.status(400).json({ success: false, error: "Invalid threshold values" });
    }

    await pool.query(
      `INSERT INTO ai_budgets (tool, warn_threshold_usd, stop_threshold_usd)
       VALUES ($1, $2, $3)
       ON CONFLICT (tool) DO UPDATE SET
         warn_threshold_usd = EXCLUDED.warn_threshold_usd,
         stop_threshold_usd = EXCLUDED.stop_threshold_usd`,
      [tool, Number(warnThresholdUsd), Number(stopThresholdUsd)]
    );

    const status = await getBudgetStatus(tool);
    res.status(200).json({ success: true, tool: status });
  } catch (error: any) {
    console.error("Error updating AI budget:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin-only gauges.
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
