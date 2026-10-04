import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { StoreModule } from '../store/store.module.js';
import { CheckoutController } from './checkout.controller.js';

/** The shopper-facing checkout routes: config, cart quote, create intent, capture. */
@Module({
  imports: [OrdersModule, PaymentsModule, StoreModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}
