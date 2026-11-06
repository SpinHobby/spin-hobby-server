import { Controller, Delete, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '../../../common/errors.js';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminSearchService } from './admin-search.service.js';

/** Admin > Dashboard > "Searches that found nothing": what shoppers look for and don't find. */
@ApiTags('Admin: search')
@Controller('admin/search-misses')
@Access('staff')
export class AdminSearchController {
  constructor(private readonly search: AdminSearchService) {}

  /** `?days=30` (1 to 365). */
  @Get()
  async list(@Query('days') days = '30') {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 365)
      throw new AppError('Days must be a whole number from 1 to 365.');
    return { success: true, misses: await this.search.misses(n) };
  }

  /** `?query=<the search as listed>`: the search can hold spaces and Japanese, so it goes in the query string. */
  @Delete()
  async dismiss(@CurrentUser() admin: AppUser, @Query('query') query?: string) {
    if (!query?.trim()) throw new AppError('Which search? Pass ?query=.');
    await this.search.dismiss(admin.id, query.trim().slice(0, 80));
    return { success: true };
  }
}
