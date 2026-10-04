import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';

// Per-million-token pricing (USD) for models in use. Update alongside CASHIER_MODEL.
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
};

export interface BudgetStatus {
  tool: string;
  spendUsd: number;
  warnThresholdUsd: number;
  stopThresholdUsd: number;
  status: 'ok' | 'warn' | 'blocked';
}

/** Monthly spend tracking with warn/stop thresholds, ported from the legacy ops dashboard. */
@Injectable()
export class AiUsageService {
  constructor(private readonly db: Db) {}

  estimateCost(model: string, inputTokens: number, outputTokens: number) {
    const price = PRICING_PER_MILLION[model] ?? PRICING_PER_MILLION['claude-opus-5'];
    return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  }

  record(tool: string, costUsd: number, inputTokens?: number, outputTokens?: number) {
    return this.db.exec(
      'insert into public.ai_usage_log (tool, cost_usd, input_tokens, output_tokens) values ($1, $2, $3, $4)',
      [tool, costUsd, inputTokens ?? null, outputTokens ?? null],
    );
  }

  async status(tool: string): Promise<BudgetStatus> {
    const [budget, spend] = await Promise.all([
      this.db.one<{ warn_threshold_usd: number; stop_threshold_usd: number }>(
        'select warn_threshold_usd, stop_threshold_usd from public.ai_budgets where tool = $1',
        [tool],
      ),
      this.db.one<{ total: number }>(
        "select coalesce(sum(cost_usd), 0) as total from public.ai_usage_log where tool = $1 and created_at >= date_trunc('month', now())",
        [tool],
      ),
    ]);
    const warnThresholdUsd = Number(budget?.warn_threshold_usd ?? 20);
    const stopThresholdUsd = Number(budget?.stop_threshold_usd ?? 30);
    const spendUsd = Number(spend?.total ?? 0);
    return {
      tool,
      spendUsd,
      warnThresholdUsd,
      stopThresholdUsd,
      status:
        spendUsd >= stopThresholdUsd ? 'blocked' : spendUsd >= warnThresholdUsd ? 'warn' : 'ok',
    };
  }

  async setBudget(tool: string, warnThresholdUsd: number, stopThresholdUsd: number) {
    await this.db.exec(
      `insert into public.ai_budgets (tool, warn_threshold_usd, stop_threshold_usd) values ($1, $2, $3)
       on conflict (tool) do update set warn_threshold_usd = excluded.warn_threshold_usd, stop_threshold_usd = excluded.stop_threshold_usd`,
      [tool, warnThresholdUsd, stopThresholdUsd],
    );
    return this.status(tool);
  }
}
