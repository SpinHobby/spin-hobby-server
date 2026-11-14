import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../auth/access.js';
import { AuthService, type AppUser } from '../auth/auth.service.js';
import { AddWishlistDto } from './dto/add-wishlist.dto.js';
import { CreateAlertDto } from './dto/create-alert.dto.js';
import { ProfileDto, SaveAddressDto } from './dto/profile.dto.js';
import { ProfileService } from './profile.service.js';
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
    private readonly profiles: ProfileService,
  ) {}

  /** The signed-in person's profile and role. */
  @Get('auth/me')
  @Access('user')
  me(@CurrentUser() user: AppUser) {
    return { success: true, user };
  }

  /** The customer's own name, phone and shipping address (the welcome step after signing up, and Account). */
  @Patch('account/profile')
  @Access('user')
  async profile(@CurrentUser() user: AppUser, @Body() dto: ProfileDto) {
    return { success: true, profile: await this.profiles.update(user.id, dto) };
  }

  /**
   * What checkout fills in: the saved shipping address (null when none), plus the customer's own name and phone for when there
   * is no saved address yet.
   */
  @Get('account/address')
  @Access('user')
  async address(@CurrentUser() user: AppUser) {
    return { success: true, ...(await this.profiles.checkoutDetails(user.id)) };
  }

  /** Checkout's "Save for next time": the recipient, phone and address become the default shipping address. */
  @Put('account/address')
  @Access('user')
  async saveAddress(@CurrentUser() user: AppUser, @Body() dto: SaveAddressDto) {
    return { success: true, address: await this.profiles.saveAddress(user.id, dto) };
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
