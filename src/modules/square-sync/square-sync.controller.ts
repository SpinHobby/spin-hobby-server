import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { OwnerOrSyncSecretGuard } from './owner-or-sync-secret.guard.js';
import { SquareSyncService } from './square-sync.service.js';

/** Starts a catalog sync from a scheduled job (cron, CI) without a signed-in session. */
@ApiTags('Square sync')
@Controller('square-sync')
export class SquareSyncController {
  constructor(private readonly sync: SquareSyncService) {}

  /** Pulls the Square catalog and stock into the database. Needs an owner session or the sync secret. */
  @Post()
  @HttpCode(200)
  @UseGuards(OwnerOrSyncSecretGuard)
  @ApiHeader({
    name: 'x-square-sync-secret',
    required: false,
    description: 'The shared secret, for scheduled jobs',
  })
  async trigger() {
    return { success: true, ...(await this.sync.run()) };
  }
}
