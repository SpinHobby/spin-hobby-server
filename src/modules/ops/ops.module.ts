import { Module } from '@nestjs/common';
import { CashierModule } from '../cashier/cashier.module.js';
import { OpsController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

/** Owner-only operations: AI spend budgets and database diagnostics. */
@Module({
  imports: [CashierModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
