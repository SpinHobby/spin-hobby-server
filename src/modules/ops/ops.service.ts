import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import { AiUsageService } from '../cashier/ai-usage.service.js';
import { CASHIER_AI_TOOL } from '../cashier/identify.service.js';

// Add a tool here whenever a new AI API is wired in; unknown tools fall back to $20/$30 budgets.
const TRACKED_AI_TOOLS = [CASHIER_AI_TOOL];

/** Owner-only operations: AI spend and a look at the database size. */
@Injectable()
export class OpsService {
  constructor(
    private readonly db: Db,
    private readonly usage: AiUsageService,
  ) {}

  /** This month's spend and limits for every tracked AI tool. */
  aiUsage() {
    return Promise.all(TRACKED_AI_TOOLS.map((tool) => this.usage.status(tool)));
  }

  setBudget(tool: string, warnUsd: number, stopUsd: number) {
    if (!TRACKED_AI_TOOLS.includes(tool)) throw new AppError('Unknown AI tool.', 404);
    return this.usage.setBudget(tool, warnUsd, stopUsd);
  }

  /** Total database size and the ten biggest tables. */
  async databaseSize() {
    const [size, tables] = await Promise.all([
      this.db.one<{ bytes: number }>(
        'select pg_database_size(current_database())::bigint as bytes',
      ),
      this.db.many<{ name: string; bytes: number; row_estimate: number }>(
        `select relname as name, pg_total_relation_size(relid)::bigint as bytes, n_live_tup::bigint as row_estimate
           from pg_stat_user_tables where schemaname = 'public' order by pg_total_relation_size(relid) desc limit 10`,
      ),
    ]);
    return {
      totalBytes: Number(size?.bytes ?? 0),
      tables: tables.map((t) => ({
        name: t.name,
        bytes: Number(t.bytes),
        rowEstimate: Number(t.row_estimate),
      })),
    };
  }
}
