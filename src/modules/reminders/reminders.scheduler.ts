import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isTest } from '../../config/app.config.js';
import { EmailService } from '../../integrations/email/email.service.js';
import { CartReminderService } from './cart-reminder.service.js';
import { FollowService } from './follow.service.js';

/** How often to look for cart reminders and pre-order news that are due. */
const CHECK_MINUTES = 15;

/** Sends the opt-in emails when they're due. Off in tests and without email (RESEND_API_KEY, FROM_EMAIL). */
@Injectable()
export class RemindersScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly email: EmailService,
    private readonly carts: CartReminderService,
    private readonly follows: FollowService,
  ) {}

  onModuleInit() {
    if (isTest() || !this.email.configured) return;
    this.timer = setInterval(() => void this.run(), CHECK_MINUTES * 60_000);
    this.timer.unref();
    this.logger.log(`Cart reminders and pre-order news: checking every ${CHECK_MINUTES} min.`);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async run(now = new Date()) {
    const carts = await this.carts.sendDue(now).catch((e) => this.fail('cart reminders', e));
    const news = await this.follows.announceDue(now).catch((e) => this.fail('pre-order news', e));
    return { carts, news };
  }

  private fail(what: string, e: unknown) {
    this.logger.warn(`Sending ${what} failed: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
