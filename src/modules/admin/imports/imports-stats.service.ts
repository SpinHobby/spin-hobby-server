import { Injectable } from '@nestjs/common';
import { Db } from '../../../database/db.service.js';
import { REVIEW_FIELDS, type ReviewField } from './review.js';

const WEEKS = 8;

/**
 * Admin > Dashboard > "Gleamshelf": how much listing work the app takes off the shop. Drafts received, added, restocked and rejected; how many went
 * in as the app wrote them; what people change most; whether prices land in the app's market range; how long drafts wait; and the photo queue's
 * output and seconds per photo. Only counts: no product names, no people.
 */
@Injectable()
export class ImportsStatsService {
  constructor(private readonly db: Db) {}

  async stats(days: number) {
    const since = `now() - make_interval(days => ${Math.trunc(days)})`;
    const [received, decided, adds, waiting, waited, photos, weeks] = await Promise.all([
      this.db.one<{ n: number }>(
        `select count(*)::int as n from public.product_imports where created_at >= ${since}`,
      ),
      this.db.many<{ action: string; n: number }>(
        `select action, count(*)::int as n from public.admin_logs
          where action in ('imports.added', 'imports.restocked', 'imports.rejected') and created_at >= ${since}
          group by action`,
      ),
      // adds made since the review was recorded (older ones have no `review` and are left out of the share, not counted as edited)
      this.db.many<{ changed: ReviewField[]; price_in_market: boolean | null }>(
        `select coalesce(data->'review'->'changed', '[]'::jsonb) as changed, (data->'review'->>'priceInMarket')::boolean as price_in_market
           from public.admin_logs
          where action = 'imports.added' and data ? 'review' and created_at >= ${since}`,
      ),
      this.db.one<{ n: number; oldest_days: number | null }>(
        `select count(*)::int as n, floor(extract(epoch from now() - min(created_at)) / 86400)::int as oldest_days
           from public.product_imports where status = 'draft'`,
      ),
      // from the moment the photo was taken through (the app's receivedAt, else when it arrived) to a person's decision
      this.db.one<{ median_hours: number | null }>(
        `select percentile_cont(0.5) within group (
                  order by extract(epoch from decided_at - coalesce((details->>'receivedAt')::timestamptz, created_at)) / 3600
                )::float as median_hours
           from public.product_imports where decided_at is not null and decided_at >= ${since}`,
      ),
      this.db.one<{
        finished: number;
        used: number;
        failed: number;
        median_seconds: number | null;
      }>(
        `select count(*) filter (where status in ('done', 'applied', 'rejected'))::int as finished,
                count(*) filter (where status = 'applied')::int as used,
                count(*) filter (where status = 'failed')::int as failed,
                percentile_cont(0.5) within group (order by (details->>'seconds')::float)
                  filter (where details ? 'seconds' and jsonb_typeof(details->'seconds') = 'number')::float as median_seconds
           from public.photo_jobs where created_at >= ${since}`,
      ),
      this.db.many<{ week: string; received: number; added: number }>(
        `select to_char(w.week, 'YYYY-MM-DD') as week,
                (select count(*)::int from public.product_imports i
                  where i.created_at >= w.week and i.created_at < w.week + interval '7 days') as received,
                (select count(*)::int from public.admin_logs l
                  where l.action in ('imports.added', 'imports.restocked')
                    and l.created_at >= w.week and l.created_at < w.week + interval '7 days') as added
           from generate_series(date_trunc('week', now()) - interval '${WEEKS - 1} weeks', date_trunc('week', now()), interval '7 days') as w(week)
          order by w.week`,
      ),
    ]);
    const count = (action: string) => decided.find((d) => d.action === action)?.n ?? 0;
    // jsonb comes back as text from some drivers
    for (const a of adds)
      if (typeof a.changed === 'string') a.changed = JSON.parse(a.changed) as ReviewField[];
    const priced = adds.filter((a) => a.price_in_market !== null);
    return {
      days,
      received: received?.n ?? 0,
      added: count('imports.added'),
      restocked: count('imports.restocked'),
      rejected: count('imports.rejected'),
      waiting: waiting?.n ?? 0,
      oldestWaitingDays: waiting?.n ? (waiting.oldest_days ?? 0) : null,
      // of the adds that recorded what changed
      reviewed: adds.length,
      unedited: adds.filter((a) => !a.changed.length).length,
      changes: Object.fromEntries(
        REVIEW_FIELDS.map((f) => [f, adds.filter((a) => a.changed.includes(f)).length]),
      ) as Record<ReviewField, number>,
      priced: priced.length,
      priceInMarket: priced.filter((a) => a.price_in_market).length,
      medianHoursToDecide:
        waited?.median_hours == null ? null : Math.round(waited.median_hours * 10) / 10,
      photos: {
        finished: photos?.finished ?? 0,
        used: photos?.used ?? 0,
        failed: photos?.failed ?? 0,
        medianSeconds: photos?.median_seconds == null ? null : Math.round(photos.median_seconds),
      },
      weeks,
    };
  }
}
