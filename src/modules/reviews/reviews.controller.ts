import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewsService } from './reviews.service.js';

/** Product reviews as shoppers see and write them. (Approving them is Admin > Reviews.) */
@ApiTags('Reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** A product's approved reviews and star summary. */
  @Get('products/:itemId/reviews')
  async list(@Param('itemId') itemId: string) {
    return { success: true, ...(await this.reviews.forProduct(itemId)) };
  }

  /** Write a review of something you bought. Open to guests (order number + email); rate-limited like the guest order lookup. */
  @Post('reviews')
  @HttpCode(200)
  @RateLimit({ limit: 10, windowMs: 10 * 60_000 })
  async create(@CurrentUser() user: AppUser | null, @Body() dto: CreateReviewDto) {
    return { success: true, review: await this.reviews.create(user, dto) };
  }
}
