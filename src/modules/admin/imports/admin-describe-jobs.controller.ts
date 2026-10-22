import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { DescribeJobsService } from './describe-jobs.service.js';
import { ApplyDescriptionDto, DescribeBatchDto } from './dto/describe.dto.js';

/** Descriptions for products already in the shop: a photo computer proposes them, a person applies or skips each one. */
@ApiTags('Admin: product descriptions')
@Controller('admin/describe-jobs')
@Access('staff')
export class AdminDescribeJobsController {
  constructor(private readonly jobs: DescribeJobsService) {}

  /** Sends products to the photo computer: the ones picked (`ids`) or every visible one without a description (`missing`). */
  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() dto: DescribeBatchDto) {
    return { success: true, ...(await this.jobs.createBatch(admin.id, dto)) };
  }

  /** The queue and the proposals waiting for a person (`status=open`, the default), only those waiting (`done`), or the ones already handled (`finished`). */
  @Get()
  async list(@Query('status') status?: string) {
    const s = status === 'done' || status === 'finished' ? status : 'open';
    return { success: true, ...(await this.jobs.list(s)) };
  }

  /** Writes the description (as edited) to the product, and the series and maker if sent. */
  @Post(':id/apply')
  @HttpCode(200)
  async apply(
    @CurrentUser() admin: AppUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyDescriptionDto,
  ) {
    await this.jobs.apply(admin.id, id, dto);
    return { success: true };
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  async dismiss(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.jobs.dismiss(admin.id, id);
    return { success: true };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.jobs.cancel(admin.id, id);
    return { success: true };
  }

  @Post(':id/retry')
  @HttpCode(200)
  async retry(@CurrentUser() admin: AppUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.jobs.retry(admin.id, id);
    return { success: true };
  }

  /** Takes every product that has not started out of the queue. */
  @Post('cancel-queued')
  @HttpCode(200)
  async cancelQueued(@CurrentUser() admin: AppUser) {
    return { success: true, ...(await this.jobs.cancelQueued(admin.id)) };
  }
}
