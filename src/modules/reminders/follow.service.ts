import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { StorefrontProductRow } from '../../database/rows.js';
import { EmailService } from '../../integrations/email/email.service.js';

export type FollowKind = 'series' | 'maker';

/** Only pre-orders this new are announced (one added long ago and only now noticed isn't news). */
export const ANNOUNCE_WITHIN_DAYS = 14;

/**
 * "Email me new pre-orders from Frieren" (a series) or "from Good Smile Company" (a maker). Open to guests by email, like restock
 * alerts. A new pre-order is announced once, in one email per follower listing everything new they follow, with a stop link
 * per follow.
 */
@Injectable()
export class FollowService {
  private readonly logger = new Logger(FollowService.name);

  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  /** Following again is fine (nothing changes). Only a series or maker some product in the shop has can be followed. */
  async follow(email: string, kind: FollowKind, name: string, userId: string | null) {
    const column = kind === 'series' ? 'series' : 'manufacturer';
    const known = await this.db.one<{ name: string }>(
      `select ${column} as name from public.storefront_products where lower(${column}) = lower($1) limit 1`,
      [name],
    );
    if (!known)
      throw new AppError(`No ${kind === 'series' ? 'series' : 'maker'} by that name in the shop.`);
    await this.db.exec(
      `insert into public.follows (email, kind, name, user_id) values ($1, $2, $3, $4)
       on conflict (email, kind, lower(name)) do update set user_id = coalesce(excluded.user_id, follows.user_id)`,
      [email, kind, known.name, userId],
    );
    return { kind, name: known.name };
  }

  /** Stops one follow (the link in each email). */
  async stop(token: string) {
    const row = await this.db.one<{ kind: FollowKind; name: string }>(
      'delete from public.follows where token = $1 returning kind, name',
      [token],
    );
    return row;
  }

  /**
   * Emails followers about pre-orders they haven't heard of. The first run only records what's already there (so switching this
   * on doesn't announce the whole catalogue). Returns how many emails went out.
   */
  async announceDue(now = new Date()) {
    if (!this.email.configured) return 0;
    const started = await this.db.one('select 1 from public.preorder_announcements limit 1');
    const fresh = await this.db.many<StorefrontProductRow>(
      `select p.* from public.storefront_products p
        where p.status = 'pre'
          and not exists (select 1 from public.preorder_announcements a where a.square_item_id = p.id)
        order by p.created_at`,
    );
    if (!fresh.length) return 0;
    await this.db.exec(
      `insert into public.preorder_announcements (square_item_id, announced_at)
       select unnest($1::text[]), $2 on conflict do nothing`,
      [fresh.map((p) => p.id), now.toISOString()],
    );
    if (!started) {
      this.logger.log(
        `Pre-order news: ${fresh.length} current pre-orders recorded; new ones from now on are announced.`,
      );
      return 0;
    }
    const cutoff = now.getTime() - ANNOUNCE_WITHIN_DAYS * 86_400_000;
    const news = fresh.filter((p) => new Date(p.created_at).getTime() >= cutoff);
    if (!news.length) return 0;

    const follows = await this.db.many<{
      email: string;
      kind: FollowKind;
      name: string;
      token: string;
    }>(
      `select email, kind, name, token from public.follows
        where (kind = 'series' and lower(name) = any($1::text[])) or (kind = 'maker' and lower(name) = any($2::text[]))`,
      [
        [...new Set(news.map((p) => p.series?.toLowerCase()).filter(Boolean))],
        [...new Set(news.map((p) => p.manufacturer?.toLowerCase()).filter(Boolean))],
      ],
    );
    // one email per follower: the new pre-orders from everything they follow, each follow with its own stop link
    const byEmail = new Map<string, typeof follows>();
    for (const f of follows) byEmail.set(f.email, [...(byEmail.get(f.email) ?? []), f]);
    let sent = 0;
    for (const [to, theirs] of byEmail) {
      const matches = (p: StorefrontProductRow, f: (typeof theirs)[number]) =>
        (f.kind === 'series' ? p.series : p.manufacturer)?.toLowerCase() === f.name.toLowerCase();
      const products = news.filter((p) => theirs.some((f) => matches(p, f)));
      const subject =
        products.length === 1
          ? `New pre-order: ${products[0].name}`
          : `${products.length} new pre-orders at Spin Hobby`;
      const ok = await this.email
        .send(to, subject.slice(0, 150), this.email.preorderNewsHtml(products, theirs))
        .catch(() => false);
      if (ok) sent++;
    }
    if (sent) this.logger.log(`Sent ${sent} pre-order news email${sent === 1 ? '' : 's'}.`);
    return sent;
  }
}
