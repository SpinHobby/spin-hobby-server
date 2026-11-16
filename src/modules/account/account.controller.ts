import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../auth/access.js';
import { AuthService, type AppUser } from '../auth/auth.service.js';
import { AddWishlistDto } from './dto/add-wishlist.dto.js';
import { CreateAlertDto } from './dto/create-alert.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
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
    private readonly profile: ProfileService,
  ) {}

  /** The signed-in person's profile and role. */
  @Get('auth/me')
  @Access('user')
  me(@CurrentUser() user: AppUser) {
    return { success: true, user };
  }

  /** Changes the signed-in person's own name, and returns the user as `/auth/me` would. */
  @Put('account/profile')
  @Access('user')
  async updateProfile(
    @CurrentUser() user: AppUser,
    @Headers('authorization') authorization: string,
    @Body() dto: UpdateProfileDto,
  ) {
    await this.profile.saveName(user.id, dto);
    // `user` was built before the update, so re-read it; `?? user` only guards the types.
    const fresh = (await this.auth.userFromAuthorization(authorization)) ?? user;
    return { success: true, user: fresh };
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
