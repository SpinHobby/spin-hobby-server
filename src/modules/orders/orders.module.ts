import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module.js';
import { StoreModule } from '../store/store.module.js';
import { OrderHistoryController } from './order-history.controller.js';
import { OrderHistoryService } from './order-history.service.js';
import { OrdersService } from './orders.service.js';
import { QuoteService } from './quote.service.js';

/** Order lifecycle: pricing a cart (QuoteService) and creating, paying and expiring orders (OrdersService). */
@Module({
  imports: [StoreModule, EmailModule],
  controllers: [OrderHistoryController],
  providers: [QuoteService, OrdersService, OrderHistoryService],
  exports: [QuoteService, OrdersService],
})
export class OrdersModule {}
