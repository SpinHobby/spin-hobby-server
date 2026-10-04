import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AccountController } from './account.controller.js';

/** A signed-in customer: profile, wishlist, restock alerts, order history. */
@Module({
  imports: [AuthModule],
  controllers: [AccountController],
})
export class AccountModule {}
