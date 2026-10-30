import { Module } from '@nestjs/common';
import { EasyPostClient } from '../../integrations/easypost/easypost.client.js';
import { ShippingRatesService } from './shipping-rates.service.js';

/** Courier options for a cart: live rates through EasyPost, or the shop's flat prices. */
@Module({
  providers: [EasyPostClient, ShippingRatesService],
  exports: [ShippingRatesService],
})
export class ShippingModule {}
