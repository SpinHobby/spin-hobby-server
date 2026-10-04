import { Module } from '@nestjs/common';
import { PayPalClient } from './paypal.client.js';

/** The PayPal client (create/capture orders, refunds, webhook verification). */
@Module({
  providers: [PayPalClient],
  exports: [PayPalClient],
})
export class PayPalModule {}
