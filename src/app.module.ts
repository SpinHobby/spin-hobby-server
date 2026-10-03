import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccountController } from './account/account.controller.js';
import { AdminCatalogController } from './admin/admin-catalog.controller.js';
import { CatalogSearchService } from './admin/catalog-search.service.js';
import { AdminCategoriesController } from './admin/admin-categories.controller.js';
import { AdminContentController } from './admin/admin-content.controller.js';
import { AdminMerchController } from './admin/admin-merch.controller.js';
import { AdminOrdersController } from './admin/admin-orders.controller.js';
import { AccessGuard } from './auth/access.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AiUsageService } from './cashier/ai-usage.service.js';
import { CashierController } from './cashier/cashier.controller.js';
import { IdentifyService } from './cashier/identify.service.js';
import { SquareCatalogService } from './cashier/square-catalog.service.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { CatalogService } from './catalog/catalog.service.js';
import { CheckoutController } from './checkout/checkout.controller.js';
import { QuoteService } from './checkout/quote.service.js';
import { AdminLog } from './common/admin-log.service.js';
import { JsonErrorFilter } from './common/http-exception.filter.js';
import { RateLimitGuard } from './common/rate-limit.js';
import { DbModule } from './db/db.module.js';
import { EmailService } from './email/email.service.js';
import { HealthController } from './health/health.controller.js';
import { MigrationService } from './migrations/migration.service.js';
import { OpsController } from './ops/ops.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { PayPalClient } from './payments/paypal.client.js';
import { PaymentsService } from './payments/payments.service.js';
import { SampleImagesController } from './sample/sample.controller.js';
import { SampleDataService } from './sample/sample.service.js';
import { SquareClient } from './payments/square.client.js';
import { SquareSyncController } from './square-sync/square-sync.controller.js';
import { SquareSyncService } from './square-sync/square-sync.service.js';
import { StorageService } from './storage/storage.service.js';
import { StoreService } from './store/store.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';

@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    CatalogController,
    AuthController,
    AccountController,
    CheckoutController,
    WebhooksController,
    AdminCatalogController,
    AdminOrdersController,
    AdminContentController,
    AdminCategoriesController,
    AdminMerchController,
    SquareSyncController,
    CashierController,
    OpsController,
    SampleImagesController,
  ],
  providers: [
    // Limits run before AccessGuard so abusive traffic never costs a profile lookup.
    RateLimitGuard,
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: JsonErrorFilter },
    AuthService,
    AdminLog,
    StoreService,
    CatalogService,
    CatalogSearchService,
    QuoteService,
    OrdersService,
    PaymentsService,
    PayPalClient,
    SquareClient,
    EmailService,
    SquareSyncService,
    SquareCatalogService,
    AiUsageService,
    IdentifyService,
    StorageService,
    MigrationService,
    SampleDataService,
  ],
})
export class AppModule {}
