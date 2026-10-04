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
import { AdminLog } from './admin-log.service.js';
import { AdminMerchController } from './admin-merch.controller.js';
import { AdminOrdersController } from './admin-orders.controller.js';
import { CatalogSearchService } from './catalog-search.service.js';
import { AdminEventsController } from './events/admin-events.controller.js';
import { AdminEventsService } from './events/admin-events.service.js';
import { AdminHomepageController } from './homepage/admin-homepage.controller.js';
import { AdminHomepageService } from './homepage/admin-homepage.service.js';
import { AdminSettingsController } from './settings/admin-settings.controller.js';
import { AdminSettingsService } from './settings/admin-settings.service.js';
import { AdminSquareController } from './square/admin-square.controller.js';
import { AdminSquareService } from './square/admin-square.service.js';

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
    AdminCategoriesController,
    AdminMerchController,
    AdminSettingsController,
    AdminHomepageController,
    AdminEventsController,
    AdminSquareController,
  ],
  providers: [
    AdminLog,
    CatalogSearchService,
    AdminSettingsService,
    AdminHomepageService,
    AdminEventsService,
    AdminSquareService,
  ],
})
export class AdminModule {}
