import { Module } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service.js';

/** The live CAD→USD rate from the Bank of Canada, for the shop's US dollar estimates (orders are always charged in CAD). */
@Module({
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class FxModule {}
