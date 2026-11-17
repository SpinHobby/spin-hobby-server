import { Injectable } from '@nestjs/common';
import { Db } from '../../database/db.service.js';
import { resendDailyLimit, resendMonthlyLimit } from '../../config/email.config.js';

/** What an email is for. Codes and order emails come first when the limit is near; news waits first. */
export type EmailKind = 'code' | 'order' | 'welcome' | 'news';
const PRIORITY: Record<EmailKind, number> = { code: 0, order: 1, welcome: 2, news: 3 };
/** News (restock alerts, reminders, pre-order news) stops at this share of the daily limit, keeping the rest for codes and orders. */
export const NEWS_SHARE = 0.8;

export interface QueuedEmail {
  id: number;
  to_email: string;
  subject: string;
  html: string;
  kind: EmailKind;
}

/** Counts real emails sent (per UTC day) and keeps the ones that would go over Resend's limits until they reset. */
@Injectable()
export class EmailQuotaService {
  constructor(private readonly db: Db) {}

  /** Sent today and this month (UTC), and the limits (0 = none). */
  async usage() {
    const row = await this.db.one<{ today: number; month: number }>(
      `select coalesce(sum(sent) filter (where day = (now() at time zone 'utc')::date), 0)::int as today,
              coalesce(sum(sent), 0)::int as month
         from public.email_usage
        where day >= date_trunc('month', now() at time zone 'utc')::date`,
    );
    return {
      today: row?.today ?? 0,
      month: row?.month ?? 0,
      dailyLimit: resendDailyLimit(),
      monthlyLimit: resendMonthlyLimit(),
    };
  }

  /** How many more emails of this kind may go out right now (Infinity when there are no limits). */
  async room(kind: EmailKind) {
    const u = await this.usage();
    const daily = u.dailyLimit
      ? Math.floor(u.dailyLimit * (kind === 'news' ? NEWS_SHARE : 1)) - u.today
      : Infinity;
    const monthly = u.monthlyLimit
      ? Math.floor(u.monthlyLimit * (kind === 'news' ? NEWS_SHARE : 1)) - u.month
      : Infinity;
    return Math.max(0, Math.min(daily, monthly));
  }

  async count() {
    await this.db.exec(
      `insert into public.email_usage (day, sent) values ((now() at time zone 'utc')::date, 1)
       on conflict (day) do update set sent = public.email_usage.sent + 1`,
    );
  }

  async enqueue(to: string, subject: string, html: string, kind: EmailKind, error?: string) {
    await this.db.exec(
      `insert into public.email_queue (to_email, subject, html, kind, priority, last_error)
       values ($1, $2, $3, $4, $5, $6)`,
      [to, subject, html, kind, PRIORITY[kind], error ?? null],
    );
  }

  /** Waiting emails, most important and oldest first. */
  waiting(limit: number) {
    return this.db.many<QueuedEmail>(
      `select id, to_email, subject, html, kind from public.email_queue
        where sent_at is null order by priority, created_at limit $1`,
      [limit],
    );
  }

  async markSent(id: number) {
    await this.db.exec('update public.email_queue set sent_at = now() where id = $1', [id]);
  }

  async markFailed(id: number, error: string) {
    await this.db.exec(
      'update public.email_queue set attempts = attempts + 1, last_error = $2 where id = $1',
      [id, error.slice(0, 300)],
    );
  }

  /** For Admin > Dashboard: how many wait, by kind, and since when. */
  async waitingSummary() {
    const rows = await this.db.many<{ kind: EmailKind; n: number; oldest: string }>(
      `select kind, count(*)::int as n, min(created_at) as oldest from public.email_queue
        where sent_at is null group by kind`,
    );
    const byKind = { code: 0, order: 0, welcome: 0, news: 0 } as Record<EmailKind, number>;
    for (const r of rows) byKind[r.kind] = r.n;
    const oldest = rows.map((r) => r.oldest).sort()[0] ?? null;
    return { total: rows.reduce((s, r) => s + r.n, 0), byKind, oldestAt: oldest };
  }
}
