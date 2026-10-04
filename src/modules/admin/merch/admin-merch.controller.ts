import { Body, Controller, Delete, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminMerchService } from './admin-merch.service.js';
import { CreateManualProductDto } from './dto/create-manual-product.dto.js';
import { UpdateManualProductDto } from './dto/update-manual-product.dto.js';
import { UploadImageDto } from './dto/upload-image.dto.js';

/** Hand-entered merchandise (not in Square) and the photo uploads the admin uses for it. */
@ApiTags('Admin: merchandise')
@Controller('admin')
@Access('staff')
export class AdminMerchController {
  constructor(private readonly merch: AdminMerchService) {}

  /** The admin UI resizes photos in the browser first, then posts base64 here. */
  @Post('uploads')
  @HttpCode(200)
  async upload(@CurrentUser() admin: AppUser, @Body() dto: UploadImageDto) {
    return { success: true, ...(await this.merch.uploadImage(admin.id, dto)) };
  }

  @Post('products')
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: CreateManualProductDto) {
    return { success: true, product: await this.merch.create(admin.id, dto) };
  }

  /** Name, price, category, stock and photos: only for hand-entered products (Square owns them otherwise). */
  @Patch('products/:id/catalog')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id') itemId: string,
    @Body() dto: UpdateManualProductDto,
  ) {
    await this.merch.update(admin.id, itemId, dto);
    return { success: true };
  }

  /** Removes a hand-entered product from the shop. */
  @Delete('products/:id')
  async archive(@CurrentUser() admin: AppUser, @Param('id') itemId: string) {
    await this.merch.archive(admin.id, itemId);
    return { success: true };
  }
}
