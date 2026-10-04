import { Module } from '@nestjs/common';
import { PayPalModule } from '../../integrations/paypal/paypal.module.js';
import { WebhooksController } from './webhooks.controller.js';

/** Inbound webhooks from Square and PayPal (signature-checked, de-duplicated). */
@Module({
  imports: [PayPalModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
