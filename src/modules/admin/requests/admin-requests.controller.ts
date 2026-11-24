import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminRequestsService } from './admin-requests.service.js';
import { AnswerRequestDto } from './dto/answer-request.dto.js';

/** "Ask us to find one": the requests shoppers left on sold items, and the shop's answers. */
@ApiTags('Admin: requests')
@Controller('admin/requests')
@Access('staff')
export class AdminRequestsController {
  constructor(private readonly requests: AdminRequestsService) {}

  /** The waiting requests by item, the most wanted first. */
  @Get()
  async list() {
    const items = await this.requests.waiting();
    return { success: true, items, waiting: items.reduce((n, i) => n + i.count, 0) };
  }

  /** Answers everyone waiting for one item (found, or not found) by email and closes their requests. */
  @Post(':productId/answer')
  @HttpCode(200)
  async answer(
    @CurrentUser() admin: AppUser,
    @Param('productId') productId: string,
    @Body() dto: AnswerRequestDto,
  ) {
    return { success: true, sent: await this.requests.answer(admin.id, productId, dto) };
  }
}
