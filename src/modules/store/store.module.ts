import { Module } from '@nestjs/common';
import { StoreService } from './store.service.js';

/** Shop-wide settings (shipping rates, tax thresholds, maintenance mode) read by checkout, orders and the admin. */
@Module({
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
