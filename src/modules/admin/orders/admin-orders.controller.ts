import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { OrderIdParam } from '../../orders/dto/order-id.dto.js';
import { AdminOrdersService } from './admin-orders.service.js';
import { AdminOrdersQuery, RefundOrderDto, ShipOrderDto } from './dto/orders.dto.js';

/** Customers' orders: browse, print a packing slip, mark shipped, refund. */
@ApiTags('Admin: orders')
@Controller('admin/orders')
@Access('staff')
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  async list(@Query() query: AdminOrdersQuery) {
    return { success: true, ...(await this.orders.list(query.status, query.limit)) };
  }

  @Get(':id')
  async detail(@Param() params: OrderIdParam) {
    return { success: true, order: await this.orders.detail(params.id) };
  }

  /** A printable packing slip as HTML. */
  @Get(':id/packing-slip')
  async packingSlip(@Param() params: OrderIdParam) {
    return { success: true, html: await this.orders.packingSlip(params.id) };
  }

  /** Marks a paid order as shipped, records the tracking number and (if email is set up) emails the customer. */
  @Post(':id/ship')
  @HttpCode(200)
  async ship(
    @CurrentUser() admin: AppUser,
    @Param() params: OrderIdParam,
    @Body() dto: ShipOrderDto,
  ) {
    return { success: true, customerEmailed: await this.orders.ship(admin.id, params.id, dto) };
  }

  /** Refunds the whole order, or part of it with `amountCents` (owner only). */
  @Post(':id/refund')
  @HttpCode(200)
  @Access('owner')
  async refund(
    @CurrentUser() admin: AppUser,
    @Param() params: OrderIdParam,
    @Body() dto: RefundOrderDto,
  ) {
    return { success: true, status: await this.orders.refund(admin.id, params.id, dto) };
  }
}
