import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccountController } from './modules/account/account.controller.js';
import { AdminCatalogController } from './modules/admin/admin-catalog.controller.js';
import { CatalogSearchService } from './modules/admin/catalog-search.service.js';
import { AdminCategoriesController } from './modules/admin/admin-categories.controller.js';
import { AdminContentController } from './modules/admin/admin-content.controller.js';
import { AdminMerchController } from './modules/admin/admin-merch.controller.js';
import { AdminOrdersController } from './modules/admin/admin-orders.controller.js';
import { AccessGuard } from './modules/auth/access.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AiUsageService } from './modules/cashier/ai-usage.service.js';
import { CashierController } from './modules/cashier/cashier.controller.js';
import { IdentifyService } from './modules/cashier/identify.service.js';
import { SquareCatalogService } from './integrations/square/square-catalog.service.js';
import { CatalogController } from './modules/catalog/catalog.controller.js';
import { CatalogService } from './modules/catalog/catalog.service.js';
import { CheckoutController } from './modules/checkout/checkout.controller.js';
import { QuoteService } from './modules/checkout/quote.service.js';
import { AdminLog } from './modules/admin/admin-log.service.js';
import { JsonErrorFilter } from './common/filters/json-error.filter.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { DbModule } from './database/db.module.js';
import { EmailService } from './integrations/email/email.service.js';
import { HealthController } from './modules/health/health.controller.js';
import { MigrationService } from './database/migrations/migration.service.js';
import { OpsController } from './modules/ops/ops.controller.js';
import { OrdersService } from './modules/orders/orders.service.js';
import { PayPalClient } from './integrations/paypal/paypal.client.js';
import { PaymentsService } from './modules/payments/payments.service.js';
import { SampleImagesController } from './modules/sample/sample.controller.js';
import { SampleDataService } from './modules/sample/sample.service.js';
import { SquareClient } from './integrations/square/square.client.js';
import { SquareSyncController } from './modules/square-sync/square-sync.controller.js';
import { SquareSyncService } from './modules/square-sync/square-sync.service.js';
import { StorageService } from './integrations/storage/storage.service.js';
import { StoreService } from './modules/store/store.service.js';
import { WebhooksController } from './modules/webhooks/webhooks.controller.js';

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
