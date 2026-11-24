import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import {
  BackgroundRuleDto,
  BoxArtDto,
  ManyBackgroundsDto,
  ProductBackgroundDto,
} from './dto/backgrounds.dto.js';
import { ProductBackgroundsService } from './product-backgrounds.service.js';

/**
 * Each product's background: the shop's rule, one product's own choice and box art, and the same choice for many products at once. Nothing
 * is re-made when a choice changes, so every one of these can be changed again later.
 */
@ApiTags('Admin: product backgrounds')
@Controller('admin')
@Access('staff')
export class AdminProductBackgroundsController {
  constructor(private readonly backgrounds: ProductBackgroundsService) {}

  /** The shop's rule and how many products have what. */
  @Get('product-backgrounds')
  async overview() {
    return { success: true, ...(await this.backgrounds.overview()) };
  }

  /** The rule for products with no choice of their own: `shop`, or `box_art` (box art where a product has one). */
  @Put('product-backgrounds/rule')
  @HttpCode(200)
  async setRule(@CurrentUser() admin: AppUser, @Body() dto: BackgroundRuleDto) {
    return { success: true, ...(await this.backgrounds.setRule(admin.id, dto.rule)) };
  }

  /** The same choice for many products (`itemIds`), or for every product when none are named. Box art only where there is one. */
  @Post('product-backgrounds/many')
  @HttpCode(200)
  async setMany(@CurrentUser() admin: AppUser, @Body() dto: ManyBackgroundsDto) {
    return {
      success: true,
      ...(await this.backgrounds.setMany(admin.id, dto.mode, dto.backgroundId, dto.itemIds)),
    };
  }

  /** Products that have a transparent photo and a photo of their box, and no box art yet. */
  @Get('product-backgrounds/box-art-candidates')
  async candidates() {
    return { success: true, items: await this.backgrounds.boxArtCandidates() };
  }

  @Get('products/:id/background')
  async one(@Param('id') itemId: string) {
    return { success: true, background: await this.backgrounds.forProduct(itemId) };
  }

  @Put('products/:id/background')
  @HttpCode(200)
  async set(
    @CurrentUser() admin: AppUser,
    @Param('id') itemId: string,
    @Body() dto: ProductBackgroundDto,
  ) {
    return {
      success: true,
      background: await this.backgrounds.set(admin.id, itemId, dto.mode, dto.backgroundId),
    };
  }

  /** Keeps the product's box art (made in the browser from one of its photos, or uploaded). */
  @Put('products/:id/box-art')
  @HttpCode(200)
  async saveBoxArt(
    @CurrentUser() admin: AppUser,
    @Param('id') itemId: string,
    @Body() dto: BoxArtDto,
  ) {
    return {
      success: true,
      background: await this.backgrounds.saveBoxArt(
        admin.id,
        itemId,
        Buffer.from(dto.data, 'base64'),
        dto.contentType,
      ),
    };
  }

  @Delete('products/:id/box-art')
  async removeBoxArt(@CurrentUser() admin: AppUser, @Param('id') itemId: string) {
    return { success: true, background: await this.backgrounds.removeBoxArt(admin.id, itemId) };
  }
}
