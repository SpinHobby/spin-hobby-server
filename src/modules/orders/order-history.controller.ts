import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { OrderIdParam } from './dto/order-id.dto.js';
import { OrderLookupQuery } from './dto/order-lookup.dto.js';
import { OrderHistoryService } from './order-history.service.js';

/** Order history as the customer sees it. (Placing and paying for orders is the checkout module.) */
@ApiTags('Orders')
@Controller('orders')
export class OrderHistoryController {
  constructor(private readonly history: OrderHistoryService) {}

  /** The signed-in customer's orders, newest first. */
  @Get()
  @Access('user')
  async list(@CurrentUser() user: AppUser) {
    return { success: true, items: await this.history.list(user.id) };
  }

  /** Guest order lookup from the confirmation email. Declared before `:id` so "lookup" isn't read as an id. */
  @Get('lookup')
  async lookup(@Query() query: OrderLookupQuery) {
    return { success: true, order: await this.history.lookupAsGuest(query.paymentId, query.email) };
  }

  /** One order with its items and history. */
  @Get(':id')
  @Access('user')
  async one(@CurrentUser() user: AppUser, @Param() params: OrderIdParam) {
    return { success: true, order: await this.history.findFor(user, params.id) };
  }
}
