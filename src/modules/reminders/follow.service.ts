import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { StorefrontProductRow } from '../../database/rows.js';
import { EmailService } from '../../integrations/email/email.service.js';

export type FollowKind = 'series' | 'maker' | 'all';

/** Only pre-orders this new are announced (one added long ago and only now noticed isn't news). */
export const ANNOUNCE_WITHIN_DAYS = 14;

/** The weekly digest ("every new pre-order"): at most one email this often per follower. */
export const DIGEST_EVERY_DAYS = 7;
/** How the weekly digest's follow is named (its stop link says "Stop news about every new pre-order"). */
export const ALL_PREORDERS = 'every new pre-order';

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

  /** The series with the most products in the shop, for "What do you collect?" after signing up. */
  async popularSeries(limit = 24) {
    const rows = await this.db.many<{ name: string }>(
      `select min(btrim(series)) as name from public.storefront_products
        where series is not null and btrim(series) <> ''
        group by lower(btrim(series))
        order by count(*) desc, min(btrim(series))
        limit $1`,
      [limit],
    );
    return rows.map((r) => r.name);
  }

  /**
   * Following again is fine (nothing changes). Only a series or maker some product in the shop has can be followed; `all` is the
   * weekly digest of every new pre-order (its name is ignored).
   */
  async follow(email: string, kind: FollowKind, name: string, userId: string | null) {
    if (kind === 'all') {
      await this.db.exec(
        `insert into public.follows (email, kind, name, user_id) values ($1, 'all', $2, $3)
         on conflict (email, kind, lower(name)) do update set user_id = coalesce(excluded.user_id, follows.user_id)`,
        [email, ALL_PREORDERS, userId],
      );
      return { kind, name: ALL_PREORDERS };
    }
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

  /**
   * The weekly digest: each "every new pre-order" follower whose last digest (or sign-up) is a week old gets the pre-orders announced
   * since then that are still open, in one email. Nothing new: nothing sent, and they're checked again next time. Returns how many
   * emails went out.
   */
  async digestDue(now = new Date()) {
    if (!this.email.configured) return 0;
    const due = await this.db.many<{
      id: string;
      email: string;
      name: string;
      token: string;
      since: string;
    }>(
      `select id, email, name, token, coalesce(last_sent_at, created_at) as since from public.follows
        where kind = 'all' and coalesce(last_sent_at, created_at) <= $1`,
      [new Date(now.getTime() - DIGEST_EVERY_DAYS * 86_400_000).toISOString()],
    );
    let sent = 0;
    for (const f of due) {
      const products = await this.db.many<StorefrontProductRow>(
        `select p.* from public.storefront_products p
           join public.preorder_announcements a on a.square_item_id = p.id
          where p.status = 'pre' and a.announced_at > $1 and p.created_at >= $2
          order by a.announced_at desc limit 24`,
        [
          f.since,
          new Date(
            now.getTime() - (DIGEST_EVERY_DAYS + ANNOUNCE_WITHIN_DAYS) * 86_400_000,
          ).toISOString(),
        ],
      );
      if (!products.length) continue;
      const subject =
        products.length === 1
          ? `New pre-order at Spin Hobby: ${products[0].name}`
          : `${products.length} new pre-orders at Spin Hobby`;
      const ok = await this.email
        .send(
          f.email,
          subject.slice(0, 150),
          this.email.preorderNewsHtml(products, [{ ...f, kind: 'all' }]),
        )
        .catch(() => false);
      if (!ok) continue;
      await this.db.exec('update public.follows set last_sent_at = $2 where id = $1', [
        f.id,
        now.toISOString(),
      ]);
      sent++;
    }
    if (sent) this.logger.log(`Sent ${sent} weekly pre-order digest${sent === 1 ? '' : 's'}.`);
    return sent;
  }
}
