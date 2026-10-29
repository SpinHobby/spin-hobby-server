import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '../../common/errors.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Access } from '../auth/access.js';
import { AnalyticsService, EVENTS, type AnalyticsEvent } from './analytics.service.js';

const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** The website's anonymous step counts and browser error reports (public), and their summary for the admin (staff). */
@ApiTags('Analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** A batch of shopping steps from one page: `{ events: [{ name: "product_view", productId }] }` (at most 20). */
  @Post('analytics/events')
  @HttpCode(204)
  @Access('public')
  @RateLimit({ limit: 60, windowMs: 60_000 })
  async events(@Body() body: unknown) {
    const list = (body as { events?: unknown })?.events;
    if (!Array.isArray(list) || list.length < 1 || list.length > 20)
      throw new AppError('Send 1 to 20 events.');
    const events = list.map((e) => {
      const name = (e as { name?: unknown })?.name;
      if (!EVENTS.includes(name as AnalyticsEvent)) throw new AppError('Unknown event.');
      return {
        name: name as AnalyticsEvent,
        productId: text((e as { productId?: unknown }).productId, 120),
      };
    });
    await this.analytics.record(events);
  }

  /** An error a shopper's browser ran into: `{ message, stack?, page?, release? }`. */
  @Post('client-errors')
  @HttpCode(204)
  @Access('public')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  clientError(@Body() body: unknown) {
    const b = (body ?? {}) as Record<string, unknown>;
    const message = text(b.message, 500);
    if (!message) throw new AppError('message is required.');
    this.analytics.clientError({
      message,
      stack: text(b.stack, 4000),
      page: text(b.page, 300),
      release: text(b.release, 40),
    });
  }

  /** Visits, product views, add-to-carts, checkouts and paid orders over the last `days` (default 30), for the dashboard. */
  @Get('admin/analytics')
  @Access('staff')
  async summary(@Query('days') days?: string) {
    return { success: true, ...(await this.analytics.summary(days ? Number(days) : 30)) };
  }
}
