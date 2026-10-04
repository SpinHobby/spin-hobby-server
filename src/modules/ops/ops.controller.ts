import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Access } from '../auth/access.js';
import { AppError } from '../../common/errors.js';
import { jsonBody } from '../../common/validation.js';
import { Db } from '../../database/db.service.js';
import { AiUsageService } from '../cashier/ai-usage.service.js';
import { CASHIER_AI_TOOL } from '../cashier/identify.service.js';

// Add a tool here whenever a new AI API is wired in; unknown tools fall back to $20/$30 budgets.
const TRACKED_AI_TOOLS = [CASHIER_AI_TOOL];

@Controller('ops')
@Access('owner')
export class OpsController {
  constructor(
    private readonly db: Db,
    private readonly usage: AiUsageService,
  ) {}

  @Get('ai-usage')
  async aiUsage() {
    return {
      success: true,
      tools: await Promise.all(TRACKED_AI_TOOLS.map((t) => this.usage.status(t))),
    };
  }

  @Put('ai-usage/:tool')
  async setBudget(@Param('tool') tool: string, @Body() body: unknown) {
    const { warnThresholdUsd, stopThresholdUsd } = jsonBody(body);
    const warn = Number(warnThresholdUsd);
    const stop = Number(stopThresholdUsd);
    if (!TRACKED_AI_TOOLS.includes(tool)) throw new AppError('Unknown AI tool.', 404);
    if (!Number.isFinite(warn) || !Number.isFinite(stop) || warn < 0 || stop < 0)
      throw new AppError('Invalid threshold values');
    return { success: true, tool: await this.usage.setBudget(tool, warn, stop) };
  }

  @Get('database')
  async database() {
    const [size, tables] = await Promise.all([
      this.db.one<{ bytes: number }>(
        'select pg_database_size(current_database())::bigint as bytes',
      ),
      this.db.many<{ name: string; bytes: number; row_estimate: number }>(
        `select relname as name, pg_total_relation_size(relid)::bigint as bytes, n_live_tup::bigint as row_estimate
           from pg_stat_user_tables where schemaname = 'public' order by pg_total_relation_size(relid) desc limit 10`,
      ),
    ]);
    // Same shape as the legacy ops dashboard endpoint.
    return {
      success: true,
      totalBytes: Number(size?.bytes ?? 0),
      tables: tables.map((t) => ({
        name: t.name,
        bytes: Number(t.bytes),
        rowEstimate: Number(t.row_estimate),
      })),
    };
  }
}
