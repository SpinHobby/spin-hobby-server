import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AdminLog } from '../admin/admin-log.service.js';
import { sentFields } from '../admin/dto/defined-fields.js';
import {
  AdjustPointsDto,
  ProductRuleDto,
  CreateRewardAppDto,
  RewardSettingsDto,
  UpdateRewardAppDto,
} from './dto/rewards.dto.js';
import { RewardsService } from './rewards.service.js';

/** Admin > Rewards (owner only: points are worth money). Settings, the connected apps and their keys, and hand adjustments. */
@ApiTags('Admin: rewards')
@Controller('admin/rewards')
@Access('owner')
export class AdminRewardsController {
  constructor(
    private readonly rewards: RewardsService,
    private readonly log: AdminLog,
  ) {}

  @Get()
  async overview() {
    return { success: true, ...(await this.rewards.overview()) };
  }

  @Put('settings')
  async settings(@CurrentUser() admin: AppUser, @Body() dto: RewardSettingsDto) {
    const changes = sentFields(dto);
    const settings = await this.rewards.updateSettings(dto);
    await this.log.write(admin.id, 'rewards.settings', 'rewards', changes);
    return { success: true, settings };
  }

  /** Lets another app give and spend points. The key is in this answer only. */
  @Post('apps')
  @HttpCode(200)
  async createApp(@CurrentUser() admin: AppUser, @Body() dto: CreateRewardAppDto) {
    const made = await this.rewards.createApp(admin.id, dto);
    await this.log.write(admin.id, 'rewards.app_created', made.app.slug, {
      dailyCap: made.app.daily_cap,
    });
    return { success: true, ...made };
  }

  @Patch('apps/:slug')
  async updateApp(
    @CurrentUser() admin: AppUser,
    @Param('slug') slug: string,
    @Body() dto: UpdateRewardAppDto,
  ) {
    const changes = sentFields(dto);
    const app = await this.rewards.updateApp(slug, dto);
    await this.log.write(admin.id, 'rewards.app_updated', slug, changes);
    return { success: true, app };
  }

  /** A new key; the old one stops working at once. */
  @Post('apps/:slug/key')
  @HttpCode(200)
  async newKey(@CurrentUser() admin: AppUser, @Param('slug') slug: string) {
    const made = await this.rewards.newKey(slug);
    await this.log.write(admin.id, 'rewards.app_key', slug);
    return { success: true, ...made };
  }

  /** How one product earns (Admin > product > Rewards points). `rule` is null when it earns the normal rate. */
  @Get('products/:id')
  @Access('staff')
  async productRule(@Param('id') id: string) {
    return { success: true, rule: await this.rewards.productRule(id) };
  }

  @Put('products/:id')
  async setProductRule(
    @CurrentUser() admin: AppUser,
    @Param('id') id: string,
    @Body() dto: ProductRuleDto,
  ) {
    const rule = await this.rewards.setProductRule(admin.id, id, dto);
    await this.log.write(admin.id, 'rewards.product_rule', id, {
      multiplier: dto.multiplier,
      endsAt: dto.endsAt,
    });
    return { success: true, rule };
  }

  @Post('adjust')
  @HttpCode(200)
  async adjust(@CurrentUser() admin: AppUser, @Body() dto: AdjustPointsDto) {
    const done = await this.rewards.adjust(admin.id, dto);
    await this.log.write(admin.id, 'rewards.adjusted', dto.email, {
      points: dto.points,
      reason: dto.reason,
    });
    return { success: true, ...done };
  }
}
