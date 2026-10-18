import { EbayModule } from './modules/ebay/ebay.module.js';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JsonErrorFilter } from './common/filters/json-error.filter.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { DbModule } from './database/db.module.js';
import { EmailModule } from './integrations/email/email.module.js';
import { PayPalModule } from './integrations/paypal/paypal.module.js';
import { SquareModule } from './integrations/square/square.module.js';
import { StorageModule } from './integrations/storage/storage.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AccessGuard } from './modules/auth/access.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CashierModule } from './modules/cashier/cashier.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CheckoutModule } from './modules/checkout/checkout.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { OpsModule } from './modules/ops/ops.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { SampleModule } from './modules/sample/sample.module.js';
import { SquareSyncModule } from './modules/square-sync/square-sync.module.js';
import { StoreModule } from './modules/store/store.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';

/**
 * The root module: lists the feature modules and registers the two things that apply to every
 * request. Read docs/ARCHITECTURE.md for how the pieces fit together.
 */
@Module({
  imports: [
    // Infrastructure and outside systems
    DbModule,
    EmailModule,
    PayPalModule,
    SquareModule,
    StorageModule,
    // Business features
    AccountModule,
    AdminModule,
    AuthModule,
    CashierModule,
    CatalogModule,
    CheckoutModule,
    EbayModule,
    HealthModule,
    OpsModule,
    OrdersModule,
    PaymentsModule,
    SampleModule,
    SquareSyncModule,
    StoreModule,
    WebhooksModule,
  ],
  providers: [
    // Guards run in the order they are listed: rate limits first, so abusive traffic never costs a profile lookup.
    RateLimitGuard,
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    // Turns every error into the { success: false, error } shape the storefront expects.
    { provide: APP_FILTER, useClass: JsonErrorFilter },
  ],
})
export class AppModule {}
