import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../../auth/access.js';
import { EmailQuotaService } from '../../../integrations/email/email-quota.service.js';
import { mailTransport } from '../../../config/email.config.js';
import { AdminDashboardService } from './admin-dashboard.service.js';

@ApiTags('Admin: dashboard')
@Controller('admin')
@Access('staff')
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly emailQuota: EmailQuotaService,
  ) {}

  /** Today's sales, what needs shipping, low stock, open pre-orders and waiting restock alerts. */
  @Get('dashboard')
  async summary() {
    return { success: true, ...(await this.dashboard.summary()) };
  }

  /**
   * Email against Resend's plan limits: sent today and this month, the limits (0 = none), and emails waiting for the limit to
   * reset (sign-up codes and order emails go first). `transport` says where email goes (resend, mailpit, off).
   */
  @Get('email-usage')
  async emailUsage() {
    const [usage, waiting] = await Promise.all([
      this.emailQuota.usage(),
      this.emailQuota.waitingSummary(),
    ]);
    return { success: true, transport: mailTransport(), ...usage, waiting };
  }
}
