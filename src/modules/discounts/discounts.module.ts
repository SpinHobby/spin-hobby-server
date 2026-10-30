import { Module } from '@nestjs/common';
import { DiscountsService } from './discounts.service.js';

/** Discount codes, shared by checkout pricing (orders) and the admin screen. */
@Module({
  providers: [DiscountsService],
  exports: [DiscountsService],
})
export class DiscountsModule {}
