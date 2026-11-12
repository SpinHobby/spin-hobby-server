import { Module } from '@nestjs/common';
import { AdminLog } from '../admin/admin-log.service.js';
import { AdminRewardsController } from './admin-rewards.controller.js';
import { RewardAppGuard } from './reward-app.guard.js';
import { AccountRewardsController, AppRewardsController } from './rewards.controller.js';
import { RewardsService } from './rewards.service.js';

/** Rewards points shared by every Spin Hobby app (docs/REWARDS.md). OrdersModule and AdminModule use the service for orders and refunds. */
@Module({
  controllers: [AccountRewardsController, AppRewardsController, AdminRewardsController],
  providers: [RewardsService, RewardAppGuard, AdminLog],
  exports: [RewardsService],
})
export class RewardsModule {}
