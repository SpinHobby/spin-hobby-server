import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminSquareService } from './admin-square.service.js';

/** Square connection status and the manual catalog sync. */
@ApiTags('Admin: Square')
@Controller('admin/square')
@Access('staff')
export class AdminSquareController {
  constructor(private readonly square: AdminSquareService) {}

  @Get('readiness')
  async readiness() {
    return { success: true, readiness: await this.square.readiness() };
  }

  /** Pulls the Square catalog and stock into the database (owner only). */
  @Post('sync')
  @HttpCode(200)
  @Access('owner')
  async sync(@CurrentUser() admin: AppUser) {
    return { success: true, sync: await this.square.runSync(admin.id) };
  }
}
