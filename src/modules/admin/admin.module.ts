import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module.js';
import { PayPalModule } from '../../integrations/paypal/paypal.module.js';
import { SquareModule } from '../../integrations/square/square.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SquareSyncModule } from '../square-sync/square-sync.module.js';
import { StoreModule } from '../store/store.module.js';
import { AdminLog } from './admin-log.service.js';
import { AdminCategoriesController } from './categories/admin-categories.controller.js';
import { AdminCategoriesService } from './categories/admin-categories.service.js';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller.js';
import { AdminDashboardService } from './dashboard/admin-dashboard.service.js';
import { AdminEventsController } from './events/admin-events.controller.js';
import { AdminEventsService } from './events/admin-events.service.js';
import { AdminHomepageController } from './homepage/admin-homepage.controller.js';
import { AdminHomepageService } from './homepage/admin-homepage.service.js';
import { AdminMerchController } from './merch/admin-merch.controller.js';
import { AdminMerchService } from './merch/admin-merch.service.js';
import { AdminOrdersController } from './orders/admin-orders.controller.js';
import { AdminOrdersService } from './orders/admin-orders.service.js';
import { AdminProductsController } from './products/admin-products.controller.js';
import { AdminProductsService } from './products/admin-products.service.js';
import { CatalogSearchService } from './products/catalog-search.service.js';
import { AdminSeriesController } from './series/admin-series.controller.js';
import { SeriesService } from './series/series.service.js';
import { ProductTransferService } from './products/product-transfer.service.js';
import { QuickAddService } from './products/quick-add.service.js';
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
    AdminDashboardController,
    AdminProductsController,
    AdminOrdersController,
    AdminCategoriesController,
    AdminMerchController,
    AdminSettingsController,
    AdminHomepageController,
    AdminEventsController,
    AdminSquareController,
    AdminSeriesController,
  ],
  providers: [
    AdminLog,
    SeriesService,
    CatalogSearchService,
    AdminDashboardService,
    AdminProductsService,
    ProductTransferService,
    QuickAddService,
    AdminMerchService,
    AdminCategoriesService,
    AdminOrdersService,
    AdminSettingsService,
    AdminHomepageService,
    AdminEventsService,
    AdminSquareService,
  ],
})
export class AdminModule {}
