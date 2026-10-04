import { Module } from '@nestjs/common';
import { PayPalModule } from '../../integrations/paypal/paypal.module.js';
import { SquareModule } from '../../integrations/square/square.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsService } from './payments.service.js';

/** Runs a payment with Square or PayPal for an order and records the result through OrdersService. */
@Module({
  imports: [OrdersModule, SquareModule, PayPalModule],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
