import { pool } from "../db/pool";

// Per-million-token pricing for models currently in use. Update if the
// cashier identify endpoint's model changes.
const MODEL_PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
};

export function estimateAnthropicCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING_PER_MILLION[model] || MODEL_PRICING_PER_MILLION["claude-opus-5"];
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export async function recordAiUsage(
  tool: string,
  costUsd: number,
  inputTokens?: number,
  outputTokens?: number
): Promise<void> {
  await pool.query(
    "INSERT INTO ai_usage_log (tool, cost_usd, input_tokens, output_tokens) VALUES ($1, $2, $3, $4)",
    [tool, costUsd, inputTokens ?? null, outputTokens ?? null]
  );
}

export interface BudgetStatus {
  tool: string;
  spendUsd: number;
  warnThresholdUsd: number;
  stopThresholdUsd: number;
  status: "ok" | "warn" | "blocked";
}

export async function getBudgetStatus(tool: string): Promise<BudgetStatus> {
  const budgetResult = await pool.query(
    "SELECT warn_threshold_usd, stop_threshold_usd FROM ai_budgets WHERE tool = $1",
    [tool]
  );
  const warnThresholdUsd = Number(budgetResult.rows[0]?.warn_threshold_usd ?? 20);
  const stopThresholdUsd = Number(budgetResult.rows[0]?.stop_threshold_usd ?? 30);

  const spendResult = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total
     FROM ai_usage_log
     WHERE tool = $1 AND created_at >= date_trunc('month', CURRENT_DATE)`,
    [tool]
  );
  const spendUsd = Number(spendResult.rows[0].total);

  const status: BudgetStatus["status"] =
    spendUsd >= stopThresholdUsd ? "blocked" : spendUsd >= warnThresholdUsd ? "warn" : "ok";

  return { tool, spendUsd, warnThresholdUsd, stopThresholdUsd, status };
}
