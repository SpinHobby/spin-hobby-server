import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipRateLimit } from '../../common/guards/rate-limit.guard.js';
import { HealthService } from './health.service.js';

/** Health checks. Not rate limited: the host and uptime monitors call these constantly. */
@ApiTags('Health')
@SkipRateLimit()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness only (used by the host's health check): the process is up. */
  @Get('live')
  live() {
    return { success: true, status: 'live', time: new Date().toISOString() };
  }

  /** Readiness and diagnostics: 200 when everything required works, 503 otherwise. */
  @Get()
  async readiness(@Res({ passthrough: true }) res: Response) {
    const { ok, body } = await this.health.report();
    res.status(ok ? 200 : 503);
    return body;
  }
}
