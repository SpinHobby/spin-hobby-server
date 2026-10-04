import { Module } from '@nestjs/common';
import { SquareModule } from '../../integrations/square/square.module.js';
import { AiUsageService } from './ai-usage.service.js';
import { CashierController } from './cashier.controller.js';
import { IdentifyService } from './identify.service.js';

/** The in-person cashier tool: photo identification with Claude and creating/editing Square items. */
@Module({
  imports: [SquareModule],
  controllers: [CashierController],
  providers: [IdentifyService, AiUsageService],
  exports: [AiUsageService],
})
export class CashierModule {}
