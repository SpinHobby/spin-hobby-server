import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module.js';
import { CartReminderService } from './cart-reminder.service.js';
import { FollowService } from './follow.service.js';
import { RemindersController } from './reminders.controller.js';
import { RemindersScheduler } from './reminders.scheduler.js';

/** Emails shoppers ask for: one reminder of a cart they didn't finish, and new pre-orders from series and makers they follow. */
@Module({
  imports: [EmailModule],
  controllers: [RemindersController],
  providers: [CartReminderService, FollowService, RemindersScheduler],
  exports: [RemindersScheduler],
})
export class RemindersModule {}
