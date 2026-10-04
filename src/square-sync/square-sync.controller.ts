import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { forbidden } from '../common/errors.js';
import { env } from '../config/env.js';
import { SquareSyncService } from './square-sync.service.js';

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Cron/CI trigger: owner session or the x-square-sync-secret header (replaces the square-sync edge function). */
@Controller('square-sync')
export class SquareSyncController {
  constructor(private readonly sync: SquareSyncService) {}

  @Post()
  @HttpCode(200)
  async trigger(
    @CurrentUser() user: AppUser | null,
    @Headers('x-square-sync-secret') secret?: string,
  ) {
    const expected = env('SQUARE_SYNC_TRIGGER_SECRET');
    const bySecret = Boolean(expected && secret && same(secret, expected));
    if (!bySecret && user?.role !== 'owner') throw forbidden('start a Square sync');
    return { success: true, ...(await this.sync.run()) };
  }
}
