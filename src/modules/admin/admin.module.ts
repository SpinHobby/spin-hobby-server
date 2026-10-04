import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module.js';
import { PayPalModule } from '../../integrations/paypal/paypal.module.js';
import { SquareModule } from '../../integrations/square/square.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SquareSyncModule } from '../square-sync/square-sync.module.js';
import { StoreModule } from '../store/store.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { AdminCategoriesController } from './admin-categories.controller.js';
import { AdminContentController } from './admin-content.controller.js';
import { AdminLog } from './admin-log.service.js';
import { AdminMerchController } from './admin-merch.controller.js';
import { AdminOrdersController } from './admin-orders.controller.js';
import { CatalogSearchService } from './catalog-search.service.js';

/** The staff/owner admin API: dashboard, products, orders, homepage, categories and merchandise. */
@Module({
  imports: [
    CatalogModule,
    EmailModule,
    PayPalModule,
    SquareModule,
    StorageModule,
    StoreModule,
    SquareSyncModule,
  ],
  controllers: [
    AdminCatalogController,
    AdminOrdersController,
    AdminContentController,
    AdminCategoriesController,
    AdminMerchController,
  ],
  providers: [AdminLog, CatalogSearchService],
})
export class AdminModule {}
