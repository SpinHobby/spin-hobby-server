import { Module } from '@nestjs/common';
import { SquareModule } from '../../integrations/square/square.module.js';
import { SquareSyncController } from './square-sync.controller.js';
import { SquareSyncService } from './square-sync.service.js';

/** Mirrors the Square catalog and stock into Postgres, on demand and optionally on a timer. */
@Module({
  imports: [SquareModule],
  controllers: [SquareSyncController],
  providers: [SquareSyncService],
  exports: [SquareSyncService],
})
export class SquareSyncModule {}
