import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/** Product reviews from verified buyers. */
@Module({
  imports: [AuthModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
