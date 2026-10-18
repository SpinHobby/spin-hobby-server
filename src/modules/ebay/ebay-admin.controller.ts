import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import {
  EbayCategoryQuery,
  EbayDisconnectDto,
  EbayListingDto,
  EbayLocationDto,
  EbaySetupDto,
} from './dto/ebay.dto.js';
import { EbayConnectionService } from './ebay-connection.service.js';
import { EbayListingsService } from './ebay-listings.service.js';
import { EbaySyncService } from './ebay-sync.service.js';

/** eBay in the admin: the connection (owners), listing products (staff), and the stock sync's state. */
@ApiTags('Admin: eBay')
@Controller('admin/ebay')
@Access('staff')
export class EbayAdminController {
  constructor(
    private readonly connection: EbayConnectionService,
    private readonly listings: EbayListingsService,
    private readonly sync: EbaySyncService,
  ) {}

  @Get()
  async status() {
    return { success: true, ebay: await this.connection.status() };
  }

  /** eBay's sign-in page for the owner to approve the shop's app. */
  @Post('connect')
  @HttpCode(200)
  @Access('owner')
  async connect(@CurrentUser() admin: AppUser) {
    return { success: true, ...(await this.connection.startConnect(admin.id)) };
  }

  @Delete('connection')
  @Access('owner')
  async disconnect(@CurrentUser() admin: AppUser, @Body() dto: EbayDisconnectDto) {
    await this.connection.disconnect(admin.id, dto.force);
    return { success: true };
  }

  /** The seller's business policies and locations on eBay, to choose from. */
  @Get('setup')
  @Access('owner')
  async setupChoices() {
    return { success: true, ...(await this.connection.setupChoices()) };
  }

  @Put('setup')
  @HttpCode(200)
  @Access('owner')
  async saveSetup(@CurrentUser() admin: AppUser, @Body() dto: EbaySetupDto) {
    return { success: true, ebay: await this.connection.saveSetup(admin.id, dto) };
  }

  @Post('locations')
  @HttpCode(200)
  @Access('owner')
  async createLocation(@CurrentUser() admin: AppUser, @Body() dto: EbayLocationDto) {
    return { success: true, ...(await this.connection.createLocation(admin.id, dto)) };
  }

  /** Checks eBay's orders (sales come off Square) and sets every listing to Square's count, now. */
  @Post('sync')
  @HttpCode(200)
  async syncNow() {
    return { success: true, ...(await this.sync.syncNow()), ebay: await this.connection.status() };
  }

  @Get('categories')
  async categories(@Query() q: EbayCategoryQuery) {
    return { success: true, categories: await this.listings.categories(q.q) };
  }

  @Get('categories/:id/aspects')
  async aspects(@Param('id') id: string) {
    return { success: true, aspects: await this.listings.aspects(id) };
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    return { success: true, ...(await this.listings.forProduct(id)) };
  }

  /** Lists the product on eBay, or revises its listing. */
  @Put('products/:id')
  @HttpCode(200)
  async save(@CurrentUser() admin: AppUser, @Param('id') id: string, @Body() dto: EbayListingDto) {
    return { success: true, ...(await this.listings.save(admin.id, id, dto)) };
  }

  @Post('products/:id/end')
  @HttpCode(200)
  async end(@CurrentUser() admin: AppUser, @Param('id') id: string) {
    return { success: true, ...(await this.listings.end(admin.id, id)) };
  }
}
