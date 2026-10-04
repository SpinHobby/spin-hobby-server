import { Module } from '@nestjs/common';
import { SquareCatalogService } from './square-catalog.service.js';
import { SquareClient } from './square.client.js';

/** Everything that talks to Square: the HTTP client (payments, orders, sync) and the SDK catalog client (cashier tool). */
@Module({
  providers: [SquareClient, SquareCatalogService],
  exports: [SquareClient, SquareCatalogService],
})
export class SquareModule {}
