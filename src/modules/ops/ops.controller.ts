import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/access.js';
import { AiBudgetDto } from './dto/ai-budget.dto.js';
import { OpsService } from './ops.service.js';

/** Owner-only operations: AI spend limits and database size. */
@ApiTags('Ops')
@Controller('ops')
@Access('owner')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('ai-usage')
  async aiUsage() {
    return { success: true, tools: await this.ops.aiUsage() };
  }

  /** Sets the warning and stop limits for one AI tool. */
  @Put('ai-usage/:tool')
  async setBudget(@Param('tool') tool: string, @Body() dto: AiBudgetDto) {
    return {
      success: true,
      tool: await this.ops.setBudget(tool, dto.warnThresholdUsd, dto.stopThresholdUsd),
    };
  }

  @Get('database')
  async database() {
    return { success: true, ...(await this.ops.databaseSize()) };
  }
}
