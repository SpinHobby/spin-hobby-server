import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '../../../common/errors.js';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminReviewsService } from './admin-reviews.service.js';
import { ModerateReviewDto } from './dto/moderate-review.dto.js';

const STATUSES = ['pending', 'approved', 'rejected'] as const;

/** Admin > Reviews: approve or hide shoppers' reviews, and answer them. */
@ApiTags('Admin: reviews')
@Controller('admin/reviews')
@Access('staff')
export class AdminReviewsController {
  constructor(private readonly reviews: AdminReviewsService) {}

  /** `?status=pending` (default), `approved` or `rejected`. */
  @Get()
  async list(@Query('status') status = 'pending') {
    if (!STATUSES.includes(status as (typeof STATUSES)[number]))
      throw new AppError('Status must be pending, approved or rejected.');
    return { success: true, ...(await this.reviews.list(status as (typeof STATUSES)[number])) };
  }

  @Put(':id')
  async moderate(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return { success: true, review: await this.reviews.moderate(admin.id, id, dto) };
  }
}
