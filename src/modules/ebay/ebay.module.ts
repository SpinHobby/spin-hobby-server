import { Module } from '@nestjs/common';
import { EbayClient } from '../../integrations/ebay/ebay.client.js';
import { SquareModule } from '../../integrations/square/square.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { EbayAdminController } from './ebay-admin.controller.js';
import { EbayConnectionService } from './ebay-connection.service.js';
import { EbayListingsService } from './ebay-listings.service.js';
import { EbayPublicController } from './ebay-public.controller.js';
import { EbaySyncService } from './ebay-sync.service.js';

/** Selling on eBay: the seller connection, listings made from Square products, and the stock sync between eBay and Square. */
@Module({
  imports: [SquareModule, AdminModule],
  controllers: [EbayAdminController, EbayPublicController],
  providers: [EbayClient, EbayConnectionService, EbayListingsService, EbaySyncService],
  exports: [EbaySyncService],
})
export class EbayModule {}
