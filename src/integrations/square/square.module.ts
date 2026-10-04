import { Module } from '@nestjs/common';
import { SquareCatalogClient } from './square-catalog.client.js';
import { SquareHttpClient } from './square-http.client.js';

/** Everything that talks to Square: `SquareHttpClient` (payments, orders, refunds, sync) and `SquareCatalogClient` (the official SDK, for the cashier tool). */
@Module({
  providers: [SquareHttpClient, SquareCatalogClient],
  exports: [SquareHttpClient, SquareCatalogClient],
})
export class SquareModule {}
