import { Module } from '@nestjs/common';
import { EmailQuotaService } from './email-quota.service.js';
import { EmailService } from './email.service.js';

/** Transactional email through Resend (order confirmations, shipping notices, restock alerts). */
@Module({
  providers: [EmailService, EmailQuotaService],
  exports: [EmailService, EmailQuotaService],
})
export class EmailModule {}
