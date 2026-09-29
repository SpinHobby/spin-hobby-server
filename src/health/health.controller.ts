import { Controller, Get } from '@nestjs/common';
import { Db } from '../db/db.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Db) {}

  /** Liveness + database reachability, for the host's health checks. */
  @Get()
  async health() {
    await this.db.one('select 1 as ok');
    return { success: true, status: 'ok', time: new Date().toISOString() };
  }
}
