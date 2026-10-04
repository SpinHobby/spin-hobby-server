import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../../auth/access.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@ApiTags('Admin: dashboard')
@Controller('admin')
@Access('staff')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  /** Today's sales, what needs shipping, low stock, open pre-orders and waiting restock alerts. */
  @Get('dashboard')
  async summary() {
    return { success: true, ...(await this.dashboard.summary()) };
  }
}
