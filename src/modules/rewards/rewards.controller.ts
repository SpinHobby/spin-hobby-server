import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../common/errors.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AppPointsDto, LinkAppDto, RedeemDto } from './dto/rewards.dto.js';
import { CallingApp, RewardAppGuard } from './reward-app.guard.js';
import { RewardsService, type RewardApp } from './rewards.service.js';

/** Using points (and linking apps that give them) waits until the customer has confirmed their email. */
function needsConfirmedEmail(user: AppUser) {
  if (!user.emailVerified)
    throw new AppError('Confirm your email to use your points.', 403, 'EMAIL_UNCONFIRMED');
}

/** A signed-in customer's own points: balance and history, turning points into a code, and linking other apps. */
@ApiTags('Account: rewards')
@Controller('account/rewards')
@Access('user')
export class AccountRewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get()
  async summary(@CurrentUser() user: AppUser) {
    return {
      success: true,
      emailConfirmed: user.emailVerified,
      ...(await this.rewards.summary(user.id)),
    };
  }

  /** Just the balance, for the storefront header (one quick read on every page). */
  @Get('balance')
  async balance(@CurrentUser() user: AppUser) {
    return { success: true, ...(await this.rewards.headerBalance(user.id)) };
  }

  /** Turns points into a one-time discount code. */
  @Post('redeem')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async redeem(@CurrentUser() user: AppUser, @Body() dto: RedeemDto) {
    needsConfirmedEmail(user);
    return { success: true, ...(await this.rewards.redeem(user.id, dto.points)) };
  }

  /** A short code to type into another Spin Hobby app (15 minutes, used once). */
  @Post('link-code')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  async linkCode(@CurrentUser() user: AppUser) {
    needsConfirmedEmail(user);
    return { success: true, ...(await this.rewards.linkCode(user.id)) };
  }

  @Delete('links/:app')
  async unlink(@CurrentUser() user: AppUser, @Param('app') app: string) {
    await this.rewards.unlink(user.id, app);
    return { success: true };
  }
}

/** What shoppers see before they buy: the points a product earns, and any promotion on it. */
@ApiTags('Rewards: shop')
@Controller('products')
@Access('public')
export class ProductPointsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get(':id/points')
  async points(@Param('id') id: string, @CurrentUser() user: AppUser | null) {
    return { success: true, ...(await this.rewards.productPoints(id, user?.id)) };
  }
}

/**
 * What another Spin Hobby app (Gleamshelf, the games) calls. Not for people: the app sends its key as a bearer token. It only ever
 * sees a member id per linked customer, never their email. See docs/REWARDS.md.
 */
@ApiTags('Rewards: apps')
@Controller('rewards')
@Access('public')
@UseGuards(RewardAppGuard)
@ApiBearerAuth()
export class AppRewardsController {
  constructor(private readonly rewards: RewardsService) {}

  /** Who the key belongs to, to check it works. */
  @Get('app')
  app(@CallingApp() app: RewardApp) {
    return { success: true, app: { slug: app.slug, name: app.name, dailyCap: app.daily_cap } };
  }

  /** Trades the code a customer made in their account for a member id. */
  @Post('link')
  @HttpCode(200)
  @RateLimit({ limit: 20, windowMs: 60_000 })
  async link(@CallingApp() app: RewardApp, @Body() dto: LinkAppDto) {
    return { success: true, ...(await this.rewards.link(app, dto.code)) };
  }

  @Get('members/:memberId')
  async member(@CallingApp() app: RewardApp, @Param('memberId') memberId: string) {
    return { success: true, ...(await this.rewards.memberBalance(app, memberId)) };
  }

  @Post('members/:memberId/award')
  @HttpCode(200)
  async award(
    @CallingApp() app: RewardApp,
    @Param('memberId') memberId: string,
    @Body() dto: AppPointsDto,
  ) {
    return { success: true, ...(await this.rewards.award(app, memberId, dto)) };
  }

  @Post('members/:memberId/spend')
  @HttpCode(200)
  async spend(
    @CallingApp() app: RewardApp,
    @Param('memberId') memberId: string,
    @Body() dto: AppPointsDto,
  ) {
    return { success: true, ...(await this.rewards.spend(app, memberId, dto)) };
  }
}
