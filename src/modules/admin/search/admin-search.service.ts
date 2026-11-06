import { Injectable } from '@nestjs/common';
import { notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import type { SearchMissRow } from '../../../database/rows.js';
import { AdminLog } from '../admin-log.service.js';

/** How many missed searches the Dashboard lists. */
const MISSES_SHOWN = 30;

@Injectable()
export class AdminSearchService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** The searches that found nothing in the last `days` days, most frequent first. */
  async misses(days: number) {
    const rows = await this.db.many<SearchMissRow>(
      `select query, times, first_at, last_at from public.search_misses
        where last_at > now() - make_interval(days => $1) order by times desc, last_at desc limit ${MISSES_SHOWN}`,
      [days],
    );
    return rows.map((r) => ({
      query: r.query,
      times: r.times,
      firstAt: r.first_at,
      lastAt: r.last_at,
    }));
  }

  /** Takes a search off the list once it's handled (stocked, or a synonym added); it comes back if shoppers miss it again. */
  async dismiss(adminId: string, query: string) {
    const gone = await this.db.one<{ times: number }>(
      'delete from public.search_misses where query = $1 returning times',
      [query],
    );
    if (!gone) throw notFound('Search');
    await this.log.write(adminId, 'search_miss.dismissed', query, { times: gone.times });
  }
}
