import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminProductsService } from './admin-products.service.js';
import { AdminProductsQuery } from './dto/admin-products.query.dto.js';
import { BulkCategoryDto } from './dto/bulk-category.dto.js';
import { CatalogSearchQuery } from './dto/catalog-search.query.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';

/** The admin Products screen: browse everything, edit storefront details, move products between categories. */
@ApiTags('Admin: products')
@Controller('admin')
@Access('staff')
export class AdminProductsController {
  constructor(private readonly products: AdminProductsService) {}

  /**
   * Every item in the catalog (including retired, hidden and unsellable ones) with search, filters, sorting and
   * paging, plus totals for the filter chips. `GET products` below only lists what shoppers can see.
   */
  @Get('catalog')
  async catalog(@Query() query: CatalogSearchQuery) {
    return { success: true, ...(await this.products.searchCatalog(query)) };
  }

  /** Storefront products plus the admin-only fields the edit drawer needs. */
  @Get('products')
  list(@Query() query: AdminProductsQuery) {
    return this.products.storefrontView(query);
  }

  /** Changes any subset of a product's storefront details. */
  @Patch('products/:id')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return {
      success: true,
      product: await this.products.updateDetails(admin.id, squareItemId, dto),
    };
  }

  /** Moves many products into one shop category (or clears it with `categoryId: null`). */
  @Post('products/bulk-category')
  @HttpCode(200)
  async bulkCategory(@CurrentUser() admin: AppUser, @Body() dto: BulkCategoryDto) {
    return {
      success: true,
      updated: await this.products.bulkCategory(admin.id, dto.ids, dto.categoryId),
    };
  }

  /** Emails everyone waiting for a restock of this product. */
  @Post('products/:id/notify-restock')
  @HttpCode(200)
  async notifyRestock(@CurrentUser() admin: AppUser, @Param('id') squareItemId: string) {
    return { success: true, sent: await this.products.notifyRestock(admin.id, squareItemId) };
  }
}
