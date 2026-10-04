import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';
import { RestockAlertService } from './restock-alert.service.js';
import { WishlistService } from './wishlist.service.js';

/** A signed-in customer: profile, wishlist and restock alerts. */
@Module({
  imports: [AuthModule],
  controllers: [AccountController],
  providers: [WishlistService, RestockAlertService],
})
export class AccountModule {}
