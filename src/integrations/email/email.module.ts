import { Module } from '@nestjs/common';
import { EmailService } from './email.service.js';

/** Transactional email through Resend (order confirmations, shipping notices, restock alerts). */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
