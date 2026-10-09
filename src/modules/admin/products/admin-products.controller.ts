import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { cleanBarcode } from '../../../common/barcode.js';
import { AppError } from '../../../common/errors.js';
import { photoLocation } from '../../catalog/photo-location.js';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminProductsService } from './admin-products.service.js';
import { ProductTransferService } from './product-transfer.service.js';
import { QuickAddService } from './quick-add.service.js';
import { SquarePhotosService } from './square-photos.service.js';
import { AddPhotoDto, PhotoOrderDto } from './dto/photos.dto.js';
import { QuickAddDto } from './dto/quick-add.dto.js';
import { AddStockDto } from './dto/add-stock.dto.js';
import { AdminProductsQuery } from './dto/admin-products.query.dto.js';
import { BulkCategoryDto } from './dto/bulk-category.dto.js';
import { FrontPageOrderDto } from './dto/front-page-order.dto.js';
import { CatalogSearchQuery } from './dto/catalog-search.query.dto.js';
import { SetVisibleDto } from './dto/set-visible.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';

/** The admin Products screen: browse everything, edit storefront details, move products between categories. */
@ApiTags('Admin: products')
@Controller('admin')
@Access('staff')
export class AdminProductsController {
  constructor(
    private readonly products: AdminProductsService,
    private readonly transfer: ProductTransferService,
    private readonly quickAdd: QuickAddService,
    private readonly photos: SquarePhotosService,
  ) {}

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

  /**
   * Sets the order of the featured products on the storefront homepage. The products listed become featured, in
   * this order, ahead of any other featured product.
   */
  @Put('products/front-page-order')
  @HttpCode(200)
  async frontPageOrder(@CurrentUser() admin: AppUser, @Body() dto: FrontPageOrderDto) {
    await this.products.setFrontPageOrder(admin.id, dto.ids);
    return { success: true };
  }

  /**
   * Adds a new product straight into Square (with photos, barcode and stock), then into our database. The
   * hand-entered route (`POST /admin/products`) stays for products kept only in our database.
   */
  @Post('products/quick-add')
  @HttpCode(200)
  async quickAddProduct(@CurrentUser() admin: AppUser, @Body() dto: QuickAddDto) {
    return { success: true, product: await this.quickAdd.add(admin.id, dto) };
  }

  /** The product that already has this barcode, or `null`: checked before adding, so a restock is not a duplicate. */
  @Get('products/by-barcode/:code')
  async byBarcode(@Param('code') code: string) {
    const clean = cleanBarcode(code);
    if (!clean) throw new AppError('That barcode is not valid (check the digits).');
    return { success: true, product: await this.quickAdd.findByBarcode(clean) };
  }

  /** Adds units to a Square product's stock. */
  @Post('products/:id/add-stock')
  @HttpCode(200)
  async addStock(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Body() dto: AddStockDto,
  ) {
    return {
      success: true,
      stockCount: await this.quickAdd.addStock(admin.id, squareItemId, dto.quantity),
    };
  }

  /**
   * Hands a Square-hosted photo to the photo editor. Browsers will not let a page edit a picture from another
   * website, so the editor loads it through here. Only Square's own picture host is fetched.
   */
  @Get('photo-proxy')
  async photoProxy(@Query('url') url: string) {
    if (photoLocation(url) !== 'square')
      throw new AppError('Only Square photos can be opened here.');
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) throw new AppError('That photo could not be loaded.', 502);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024)
      throw new AppError('That photo has an unexpected size.', 502);
    return new StreamableFile(bytes, { type: res.headers.get('content-type') ?? 'image/jpeg' });
  }

  /** A Square product's photos: the ones shown (in order) and the ones hidden. */
  @Get('products/:id/photos')
  async photoList(@Param('id') squareItemId: string) {
    return { success: true, ...(await this.photos.list(squareItemId)) };
  }

  /** Shows these photos in this order. Photos left out are hidden (kept in Square), and hidden ones listed come back. */
  @Put('products/:id/photos')
  @HttpCode(200)
  async photoOrder(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Body() dto: PhotoOrderDto,
  ) {
    return { success: true, ...(await this.photos.setOrder(admin.id, squareItemId, dto.ids)) };
  }

  /** Adds a new photo (never replaces one). With `replaces`, it takes that photo's place and the original is hidden. */
  @Post('products/:id/photos')
  @HttpCode(200)
  async photoAdd(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Body() dto: AddPhotoDto,
  ) {
    return {
      success: true,
      ...(await this.photos.add(
        admin.id,
        squareItemId,
        Buffer.from(dto.data, 'base64'),
        dto.replaces,
      )),
    };
  }

  /** Deletes one photo from Square for good. Only used when the admin chooses to delete it. */
  @Delete('products/:id/photos/:imageId')
  async photoDelete(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Param('imageId') imageId: string,
  ) {
    return { success: true, ...(await this.photos.remove(admin.id, squareItemId, imageId)) };
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

  /**
   * Shows or hides a product on the website. For a Square product the "hidden from the website" category is
   * added to (or removed from) the item in Square as well, so Square and our database stay in step.
   */
  @Put('products/:id/visibility')
  async visibility(
    @CurrentUser() admin: AppUser,
    @Param('id') squareItemId: string,
    @Body() dto: SetVisibleDto,
  ) {
    return {
      success: true,
      ...(await this.transfer.setVisible(admin.id, squareItemId, dto.visible)),
    };
  }

  /**
   * Moves a product kept in our own database into Square: it is created there (with its photos and stock),
   * its extras are carried over, and its photos are deleted from our storage. Owner only.
   */
  @Post('products/:id/transfer-to-square')
  @HttpCode(200)
  @Access('owner')
  async transferToSquare(@CurrentUser() admin: AppUser, @Param('id') squareItemId: string) {
    return {
      success: true,
      ...(await this.transfer.transferToSquare(admin.id, squareItemId)),
    };
  }
}
