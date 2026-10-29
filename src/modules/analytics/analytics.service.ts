import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { reportError } from '../../integrations/sentry/sentry.js';
import { Db } from '../../database/db.service.js';

const SHOP_TIME_ZONE = 'America/Toronto';
export const EVENTS = ['visit', 'product_view', 'add_to_cart', 'checkout_view'] as const;
export type AnalyticsEvent = (typeof EVENTS)[number];
/** Steps whose count is also kept per product. */
const PER_PRODUCT = new Set<AnalyticsEvent>(['product_view', 'add_to_cart']);
const SALE_STATUSES = ['paid', 'preorder_reserved', 'fulfilled', 'shipped', 'refunded'];

/** An error a shopper's browser ran into, sent by the website (truncated, never with personal data). */
export interface ClientErrorReport {
  message: string;
  stack: string | null;
  page: string | null;
  release: string | null;
}

/**
 * The website's own analytics: anonymous daily counts of each shopping step (no cookies, nothing that identifies a person), and
 * errors from shoppers' browsers, passed on to the same error reporting as the server's (Sentry when SENTRY_DSN is set).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('ClientError');

  constructor(private readonly db: Db) {}

  /** Adds one to each step (with its product, where it has one) for today, in shop time. */
  async record(events: { name: AnalyticsEvent; productId: string | null }[]) {
    for (const e of events) {
      await this.db.exec(
        `insert into public.analytics_daily (day, event, product_id, count)
         values ((now() at time zone '${SHOP_TIME_ZONE}')::date, $1, $2, 1)
         on conflict (day, event, product_id) do update set count = public.analytics_daily.count + 1`,
        [e.name, PER_PRODUCT.has(e.name) ? (e.productId ?? '') : ''],
      );
    }
  }

  clientError(report: ClientErrorReport) {
    const error = new Error(report.message);
    error.name = 'ClientError';
    if (report.stack) error.stack = `ClientError: ${report.message}\n${report.stack}`;
    this.logger.warn(
      `${report.message}${report.page ? ` (on ${report.page})` : ''}${report.release ? ` [${report.release}]` : ''}`,
    );
    reportError(error);
  }

  /**
   * The last `days` days: totals per step with paid orders, each day's numbers, and the most viewed products. Paid orders count
   * from the first day steps were counted (no earlier), so a new shop's funnel doesn't show more orders than checkouts.
   */
  async summary(days: number) {
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new AppError('days must be from 1 to 365.');
    const since = `(now() at time zone '${SHOP_TIME_ZONE}')::date - ${days - 1}`;
    const [steps, orders, top] = await Promise.all([
      this.db.many<{ day: string; event: AnalyticsEvent; count: number }>(
        `select day::text as day, event, sum(count)::int as count from public.analytics_daily
          where day >= ${since} group by day, event order by day`,
      ),
      this.db.many<{ day: string; count: number }>(
        `select (paid_at at time zone '${SHOP_TIME_ZONE}')::date::text as day, count(*)::int as count from public.orders
          where paid_at is not null and status::text = any($1::text[])
            and (paid_at at time zone '${SHOP_TIME_ZONE}')::date >= ${since}
            -- only from the first day steps were counted, so the funnel compares like with like
            and (paid_at at time zone '${SHOP_TIME_ZONE}')::date >= coalesce((select min(day) from public.analytics_daily), ${since})
          group by 1 order by 1`,
        [SALE_STATUSES],
      ),
      this.db.many<{ id: string; name: string | null; views: number; carts: number }>(
        `select a.product_id as id, max(p.name) as name,
                sum(a.count) filter (where a.event = 'product_view')::int as views,
                coalesce(sum(a.count) filter (where a.event = 'add_to_cart'), 0)::int as carts
           from public.analytics_daily a left join public.catalog_products p on p.square_item_id = a.product_id
          where a.day >= ${since} and a.product_id <> ''
          group by a.product_id
          having sum(a.count) filter (where a.event = 'product_view') > 0
          order by views desc, carts desc limit 10`,
      ),
    ]);
    const totals = Object.fromEntries(EVENTS.map((e) => [e, 0])) as Record<
      AnalyticsEvent | 'paid',
      number
    >;
    totals.paid = 0;
    const byDay = new Map<string, Record<AnalyticsEvent | 'paid', number>>();
    const dayRow = (day: string) => {
      let row = byDay.get(day);
      if (!row) {
        row = { visit: 0, product_view: 0, add_to_cart: 0, checkout_view: 0, paid: 0 };
        byDay.set(day, row);
      }
      return row;
    };
    for (const s of steps) {
      totals[s.event] += s.count;
      dayRow(s.day)[s.event] += s.count;
    }
    for (const o of orders) {
      totals.paid += o.count;
      dayRow(o.day).paid += o.count;
    }
    return {
      days,
      totals,
      daily: [...byDay]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, row]) => ({ day, ...row })),
      topProducts: top,
    };
  }
}
