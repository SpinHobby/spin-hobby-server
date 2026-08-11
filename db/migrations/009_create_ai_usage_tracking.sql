-- Migration: AI usage/cost tracking for the ops dashboard
-- Logs the estimated cost of every AI API call (currently just Anthropic,
-- used by the cashier's photo-identify feature) so the ops dashboard can
-- show real spend and warn/block before a budget is exceeded.

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id SERIAL PRIMARY KEY,
  tool VARCHAR(50) NOT NULL,
  cost_usd NUMERIC(10, 4) NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_tool_created ON ai_usage_log(tool, created_at);

CREATE TABLE IF NOT EXISTS ai_budgets (
  id SERIAL PRIMARY KEY,
  tool VARCHAR(50) NOT NULL UNIQUE,
  warn_threshold_usd NUMERIC(10, 2) NOT NULL DEFAULT 20,
  stop_threshold_usd NUMERIC(10, 2) NOT NULL DEFAULT 30,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_ai_budgets_updated_at BEFORE UPDATE
ON ai_budgets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO ai_budgets (tool, warn_threshold_usd, stop_threshold_usd)
VALUES ('anthropic_cashier', 20, 30)
ON CONFLICT (tool) DO NOTHING;
