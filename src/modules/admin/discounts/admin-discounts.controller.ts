import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { DiscountsService } from '../../discounts/discounts.service.js';
import { AdminLog } from '../admin-log.service.js';
import { sentFields } from '../dto/defined-fields.js';
import { CreateDiscountDto, UpdateDiscountDto } from './dto/discount.dto.js';

/** Discount codes for checkout (owner only: they change what customers pay). */
@ApiTags('Admin: discount codes')
@Controller('admin/discounts')
@Access('owner')
export class AdminDiscountsController {
  constructor(
    private readonly discounts: DiscountsService,
    private readonly log: AdminLog,
  ) {}

  @Get()
  async list() {
    return { success: true, codes: await this.discounts.list() };
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: CreateDiscountDto) {
    const code = await this.discounts.create(admin.id, dto);
    await this.log.write(admin.id, 'discount.created', code!.code, {
      kind: code!.kind,
      value: code!.value,
    });
    return { success: true, code };
  }

  /** Switch a code on or off, or change its end date, cap or note. */
  @Patch(':id')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiscountDto,
  ) {
    const changes = sentFields(dto);
    const code = await this.discounts.update(id, changes);
    await this.log.write(admin.id, 'discount.updated', code.code, changes);
    return { success: true, code };
  }
}
