import { ChannelPhotosService } from './products/channel-photos.service.js';
import { AdminPhotoBackgroundsController } from './products/admin-photo-backgrounds.controller.js';
import { PhotoBackgroundsService } from './products/photo-backgrounds.service.js';
import { ProductPhotosController } from './products/product-photos.controller.js';
import { Module } from '@nestjs/common';
import { GoogleDriveModule } from '../../integrations/google-drive/google-drive.module.js';
import { AdminAccountsController } from './accounts/admin-accounts.controller.js';
import { AdminAccountsService } from './accounts/admin-accounts.service.js';
import { AdminAuditController } from './audit/admin-audit.controller.js';
import { AdminAuditService } from './audit/admin-audit.service.js';
import { FxModule } from '../../integrations/fx/fx.module.js';
import { EmailModule } from '../../integrations/email/email.module.js';
import { PayPalModule } from '../../integrations/paypal/paypal.module.js';
import { SquareModule } from '../../integrations/square/square.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { SquareSyncModule } from '../square-sync/square-sync.module.js';
import { StoreModule } from '../store/store.module.js';
import { AdminLog } from './admin-log.service.js';
import { DiscountsModule } from '../discounts/discounts.module.js';
import { AdminDiscountsController } from './discounts/admin-discounts.controller.js';
import { AdminImportsController } from './imports/admin-imports.controller.js';
import { GleamshelfController } from './imports/gleamshelf.controller.js';
import { GleamshelfTokenGuard } from './imports/gleamshelf-token.guard.js';
import { ImportsService } from './imports/imports.service.js';
import { AdminPhotoJobsController } from './imports/admin-photo-jobs.controller.js';
import { PhotoJobsService } from './imports/photo-jobs.service.js';
import { AdminListingJobsController } from './imports/admin-listing-jobs.controller.js';
import { ListingJobsService } from './imports/listing-jobs.service.js';
import { AdminDescribeJobsController } from './imports/admin-describe-jobs.controller.js';
import { DescribeJobsService } from './imports/describe-jobs.service.js';
import { BarcodeFindingsService } from './imports/barcode-findings.service.js';
import { AdminBarcodesController } from './imports/admin-barcodes.controller.js';
import { AdminCategoriesController } from './categories/admin-categories.controller.js';
import { AdminCategoriesService } from './categories/admin-categories.service.js';
import { CategorySortingService } from './categories/category-sorting.service.js';
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
import { LabelsService } from './products/labels.service.js';
import { AdminSeriesController } from './series/admin-series.controller.js';
import { SeriesService } from './series/series.service.js';
import { ProductTransferService } from './products/product-transfer.service.js';
import { QuickAddService } from './products/quick-add.service.js';
import { SquarePhotosService } from './products/square-photos.service.js';
import { AdminSettingsController } from './settings/admin-settings.controller.js';
import { AdminSettingsService } from './settings/admin-settings.service.js';
import { AdminSquareController } from './square/admin-square.controller.js';
import { AdminSquareService } from './square/admin-square.service.js';
import { AssistantModule } from '../assistant/assistant.module.js';

/** The staff/owner admin API: dashboard, products, orders, homepage, categories and merchandise. */
@Module({
  imports: [
    AssistantModule,
    DiscountsModule,
    CatalogModule,
    GoogleDriveModule,
    FxModule,
    EmailModule,
    PayPalModule,
    SquareModule,
    StorageModule,
    StoreModule,
    SquareSyncModule,
  ],
  controllers: [
    AdminDiscountsController,
    ProductPhotosController,
    AdminAuditController,
    AdminAccountsController,
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
    AdminImportsController,
    AdminPhotoJobsController,
    AdminPhotoBackgroundsController,
    AdminListingJobsController,
    AdminDescribeJobsController,
    AdminBarcodesController,
    GleamshelfController,
  ],
  providers: [
    AdminLog,
    AdminAuditService,
    AdminAccountsService,
    ImportsService,
    PhotoJobsService,
    ListingJobsService,
    DescribeJobsService,
    BarcodeFindingsService,
    GleamshelfTokenGuard,
    SeriesService,
    CatalogSearchService,
    LabelsService,
    AdminDashboardService,
    AdminProductsService,
    ProductTransferService,
    QuickAddService,
    SquarePhotosService,
    PhotoBackgroundsService,
    ChannelPhotosService,
    AdminMerchService,
    AdminCategoriesService,
    CategorySortingService,
    AdminOrdersService,
    AdminSettingsService,
    AdminHomepageService,
    AdminEventsService,
    AdminSquareService,
  ],
  // what the eBay module builds on: product photos, the photos picked for eBay, and the admin log
  exports: [AdminLog, SquarePhotosService, ChannelPhotosService, PhotoBackgroundsService],
})
export class AdminModule {}
