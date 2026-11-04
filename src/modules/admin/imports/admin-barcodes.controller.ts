import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { BarcodeFindingsService } from './barcode-findings.service.js';

/** Barcodes the photo computer found for products that have none: a person applies or dismisses each one. */
@ApiTags('Admin: barcodes')
@Controller('admin/barcodes')
@Access('staff')
export class AdminBarcodesController {
  constructor(private readonly barcodes: BarcodeFindingsService) {}

  /** The barcodes waiting for a person, and how many products still have none, were scanned, found nothing or were done. */
  @Get()
  async list() {
    return { success: true, ...(await this.barcodes.list()) };
  }

  /** Every waiting barcode that the photo and the product pages agree on. */
  @Post('apply-agreed')
  @HttpCode(200)
  async applyAgreed(@CurrentUser() admin: AppUser) {
    return { success: true, ...(await this.barcodes.applyAgreed(admin.id)) };
  }

  /** Makes the barcode the product's JAN code. */
  @Post(':productId/apply')
  @HttpCode(200)
  async apply(@CurrentUser() admin: AppUser, @Param('productId') productId: string) {
    await this.barcodes.apply(admin.id, productId);
    return { success: true };
  }

  @Post(':productId/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentUser() admin: AppUser, @Param('productId') productId: string) {
    await this.barcodes.dismiss(admin.id, productId);
    return { success: true };
  }
}
