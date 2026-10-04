import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../auth/access.js';
import { AuthService, type AppUser } from '../auth/auth.service.js';
import { AddWishlistDto } from './dto/add-wishlist.dto.js';
import { CreateAlertDto } from './dto/create-alert.dto.js';
import { RestockAlertService } from './restock-alert.service.js';
import { WishlistService } from './wishlist.service.js';

/** A signed-in customer's own data: profile, wishlist and restock alerts (order history is in the orders module). */
@ApiTags('Account')
@Controller()
export class AccountController {
  constructor(
    private readonly auth: AuthService,
    private readonly wishlist: WishlistService,
    private readonly alerts: RestockAlertService,
  ) {}

  /** The signed-in person's profile and role. */
  @Get('auth/me')
  @Access('user')
  me(@CurrentUser() user: AppUser) {
    return { success: true, user };
  }

  /** Signs the person out on every device. */
  @Post('auth/logout')
  @HttpCode(200)
  @Access('user')
  async logout(@Headers('authorization') authorization: string) {
    await this.auth.signOut(authorization);
    return { success: true };
  }

  @Get('wishlist')
  @Access('user')
  async list(@CurrentUser() user: AppUser) {
    return { success: true, items: await this.wishlist.list(user.id) };
  }

  @Post('wishlist')
  @HttpCode(200)
  @Access('user')
  async add(@CurrentUser() user: AppUser, @Body() dto: AddWishlistDto) {
    await this.wishlist.add(user.id, dto.squareItemId);
    return { success: true };
  }

  @Delete('wishlist/:itemId')
  @Access('user')
  async remove(@CurrentUser() user: AppUser, @Param('itemId') itemId: string) {
    await this.wishlist.remove(user.id, itemId);
    return { success: true };
  }

  /** "Email me when this is back in stock." Open to guests; signed-in customers are linked to the alert. */
  @Post('alerts')
  @HttpCode(200)
  async createAlert(@CurrentUser() user: AppUser | null, @Body() dto: CreateAlertDto) {
    await this.alerts.subscribe(dto.email, dto.variationId, user?.id ?? null);
    return { success: true };
  }
}
