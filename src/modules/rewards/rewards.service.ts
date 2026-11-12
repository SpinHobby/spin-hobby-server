import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { AppError, notFound } from '../../common/errors.js';
import { Db, type Queryable } from '../../database/db.service.js';
import type { OrderRow } from '../../database/rows.js';
import {
  pointsForGoods,
  pointsToTakeBack,
  pointsValueCents,
  redeemProblem,
  type RewardRates,
} from './rewards-math.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
/** Letters and digits that can't be mixed up when typed from a screen (no 0/O, 1/I/L). */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomCode = (length: number) =>
  Array.from({ length }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
/** Every app key starts with this, so a leaked one is easy to spot and search for. */
const KEY_PREFIX = 'shr_';
const LINK_CODE_MINUTES = 15;
const CODE_VALID_DAYS = 365;
const OFF = () => new AppError('Rewards are switched off right now.', 403, 'REWARDS_OFF');

export interface RewardSettings extends RewardRates {
  enabled: boolean;
}
interface SettingsRow {
  enabled: boolean;
  points_per_dollar: number;
  cents_per_100_points: number;
  min_redeem_points: number;
}
export interface RewardApp {
  slug: string;
  name: string;
  daily_cap: number;
  active: boolean;
  created_at: string;
  last_used_at: string | null;
}
/** One change to a balance, as `post` records it. */
interface Posting {
  userId: string;
  /** 'shop', 'admin' or a connected app's slug. */
  app: string;
  points: number;
  reason: string;
  /** The giver's own id for the event; the same (app, ref) only ever counts once. */
  ref?: string | null;
  createdBy?: string | null;
  /** A spend must be covered by the balance (true), or may push it below zero (a refund taking back points already spent). */
  mustCover?: boolean;
}

/**
 * Rewards points, one balance per account shared by every Spin Hobby app. The shop gives points for paid orders and takes them back
 * on refunds; customers turn points into a one-time discount code; other apps give and spend points with their own key once the
 * customer links them (see docs/REWARDS.md). Every change is a row in reward_entries; reward_balances is the running total.
 */
@Injectable()
export class RewardsService {
  constructor(private readonly db: Db) {}

  // ---------- settings ----------

  async settings(tx?: Queryable): Promise<RewardSettings> {
    const row = await this.db.one<SettingsRow>(
      'select enabled, points_per_dollar, cents_per_100_points, min_redeem_points from public.reward_settings where id',
      [],
      tx,
    );
    return {
      enabled: Boolean(row?.enabled),
      pointsPerDollar: Number(row?.points_per_dollar ?? 1),
      centsPer100Points: Number(row?.cents_per_100_points ?? 100),
      minRedeemPoints: Number(row?.min_redeem_points ?? 500),
    };
  }

  async updateSettings(changes: Partial<RewardSettings>) {
    await this.db.exec(
      `insert into public.reward_settings (id) values (true) on conflict do nothing;`,
    );
    await this.db.exec(
      `update public.reward_settings set
          enabled = coalesce($1, enabled),
          points_per_dollar = coalesce($2, points_per_dollar),
          cents_per_100_points = coalesce($3, cents_per_100_points),
          min_redeem_points = coalesce($4, min_redeem_points),
          updated_at = now()
        where id`,
      [
        changes.enabled ?? null,
        changes.pointsPerDollar ?? null,
        changes.centsPer100Points ?? null,
        changes.minRedeemPoints ?? null,
      ],
    );
    return this.settings();
  }

  // ---------- the ledger ----------

  async balance(userId: string, tx?: Queryable): Promise<number> {
    const row = await this.db.one<{ points: number }>(
      'select points from public.reward_balances where user_id = $1',
      [userId],
      tx,
    );
    return Number(row?.points ?? 0);
  }

  /**
   * Records one change and moves the balance, in the caller's transaction. A (app, ref) already recorded does nothing and says so
   * (`duplicate`), so an app can safely send the same award again after a timeout.
   */
  private async post(p: Posting, tx: Queryable) {
    const entry = await this.db.one<{ id: string }>(
      `insert into public.reward_entries (user_id, app, points, reason, ref, created_by)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (app, ref) where ref is not null do nothing
       returning id`,
      [p.userId, p.app, p.points, p.reason.slice(0, 200), p.ref ?? null, p.createdBy ?? null],
      tx,
    );
    if (!entry) {
      const before = await this.db.one<{ id: string; user_id: string }>(
        'select id, user_id from public.reward_entries where app = $1 and ref = $2',
        [p.app, p.ref],
        tx,
      );
      if (before && before.user_id !== p.userId)
        throw new AppError('That ref was already used for someone else.', 409, 'REF_TAKEN');
      return {
        entryId: before?.id ?? null,
        balance: await this.balance(p.userId, tx),
        duplicate: true,
      };
    }
    await this.db.exec(
      'insert into public.reward_balances (user_id) values ($1) on conflict do nothing',
      [p.userId],
      tx,
    );
    const moved = await this.db.one<{ points: number }>(
      `update public.reward_balances set points = points + $2, updated_at = now()
        where user_id = $1 and ($3::boolean is not true or points + $2 >= 0)
        returning points`,
      [p.userId, p.points, p.points < 0 && p.mustCover !== false],
      tx,
    );
    if (!moved) throw new AppError('Not enough points.', 409, 'NOT_ENOUGH_POINTS');
    return { entryId: entry.id, balance: Number(moved.points), duplicate: false };
  }

  // ---------- the shop: orders ----------

  /** Gives a paid order's points to the account that placed it (guests earn nothing). Called inside the payment's transaction. */
  async earnForOrder(orderId: number, tx: Queryable) {
    const settings = await this.settings(tx);
    if (!settings.enabled) return 0;
    const order = await this.db.one<
      Pick<OrderRow, 'user_id' | 'subtotal_cents' | 'discount_cents'>
    >(
      'select user_id, subtotal_cents, discount_cents from public.orders where id = $1',
      [orderId],
      tx,
    );
    if (!order?.user_id) return 0;
    const points = pointsForGoods(
      Number(order.subtotal_cents) - Number(order.discount_cents ?? 0),
      settings.pointsPerDollar,
    );
    if (!points) return 0;
    await this.post(
      {
        userId: order.user_id,
        app: 'shop',
        points,
        reason: `Order #${orderId}`,
        ref: `order:${orderId}`,
      },
      tx,
    );
    return points;
  }

  /** Takes back the refunded share of what an order earned. The balance may go below zero if those points were already spent. */
  async takeBackForRefund(orderId: number, refundedCents: number, adminId: string, tx: Queryable) {
    const order = await this.db.one<Pick<OrderRow, 'user_id' | 'total_cents'>>(
      'select user_id, total_cents from public.orders where id = $1',
      [orderId],
      tx,
    );
    if (!order?.user_id) return 0;
    const rows = await this.db.one<{ earned: number; taken: number; refunds: number }>(
      `select coalesce(sum(points) filter (where ref = $1), 0)::int as earned,
              coalesce(-sum(points) filter (where ref like $1 || ':refund:%'), 0)::int as taken,
              count(*) filter (where ref like $1 || ':refund:%')::int as refunds
         from public.reward_entries where app = 'shop' and user_id = $2`,
      [`order:${orderId}`, order.user_id],
      tx,
    );
    const points = pointsToTakeBack(
      Number(rows?.earned ?? 0),
      Number(rows?.taken ?? 0),
      refundedCents,
      Number(order.total_cents),
    );
    if (!points) return 0;
    await this.post(
      {
        userId: order.user_id,
        app: 'shop',
        points: -points,
        reason: `Refund on order #${orderId}`,
        ref: `order:${orderId}:refund:${Number(rows?.refunds ?? 0) + 1}`,
        createdBy: adminId,
        mustCover: false,
      },
      tx,
    );
    return points;
  }

  // ---------- a customer's own account ----------

  /** Whether rewards are on and the balance: what the storefront header shows, in one query. */
  async headerBalance(userId: string) {
    const row = await this.db.one<{ enabled: boolean; points: number }>(
      `select coalesce((select enabled from public.reward_settings where id), false) as enabled,
              coalesce((select points from public.reward_balances where user_id = $1), 0)::int as points`,
      [userId],
    );
    return { enabled: Boolean(row?.enabled), balance: Number(row?.points ?? 0) };
  }

  /** Everything the Account > Rewards page shows. */
  async summary(userId: string) {
    const [settings, balance, entries, links, codes] = await Promise.all([
      this.settings(),
      this.balance(userId),
      this.db.many<{
        id: string;
        app: string;
        app_name: string | null;
        points: number;
        reason: string;
        created_at: string;
      }>(
        `select e.id, e.app, a.name as app_name, e.points, e.reason, e.created_at
           from public.reward_entries e left join public.reward_apps a on a.slug = e.app
          where e.user_id = $1 order by e.created_at desc limit 50`,
        [userId],
      ),
      this.db.many<{ app: string; name: string; created_at: string }>(
        `select l.app, a.name, l.created_at from public.reward_links l join public.reward_apps a on a.slug = l.app
          where l.user_id = $1 and l.unlinked_at is null order by l.created_at`,
        [userId],
      ),
      this.db.many<{
        code: string;
        value: number;
        reward_points: number;
        ends_at: string | null;
        created_at: string;
      }>(
        `select code, value, reward_points, ends_at, created_at from public.discount_codes
          where reward_user_id = $1 and active and uses < coalesce(max_uses, 1) and (ends_at is null or ends_at > now())
          order by created_at desc`,
        [userId],
      ),
    ]);
    return {
      enabled: settings.enabled,
      balance,
      rates: {
        pointsPerDollar: settings.pointsPerDollar,
        centsPer100Points: settings.centsPer100Points,
        minRedeemPoints: settings.minRedeemPoints,
      },
      worthCents: pointsValueCents(balance, settings.centsPer100Points),
      entries: entries.map((e) => ({
        id: e.id,
        app: e.app,
        appName:
          e.app_name ??
          (e.app === 'shop' ? 'Spin Hobby shop' : e.app === 'admin' ? 'Spin Hobby' : e.app),
        points: Number(e.points),
        reason: e.reason,
        createdAt: e.created_at,
      })),
      links: links.map((l) => ({ app: l.app, name: l.name, linkedAt: l.created_at })),
      codes: codes.map((c) => ({
        code: c.code,
        valueCents: Number(c.value),
        points: Number(c.reward_points),
        endsAt: c.ends_at,
      })),
    };
  }

  /** Turns points into a one-time discount code worth their value, good for a year. */
  async redeem(userId: string, points: number) {
    return this.db.transaction(async (tx) => {
      const settings = await this.settings(tx);
      if (!settings.enabled) throw OFF();
      const problem = redeemProblem(points, await this.balance(userId, tx), settings);
      if (problem) throw new AppError(problem);
      const valueCents = pointsValueCents(points, settings.centsPer100Points);
      const code = `PTS-${randomCode(10)}`;
      const spent = await this.post(
        {
          userId,
          app: 'shop',
          points: -points,
          reason: `Discount code ${code}`,
          ref: `code:${code}`,
        },
        tx,
      );
      const made = await this.db.one<{ ends_at: string }>(
        `insert into public.discount_codes (code, kind, value, max_uses, ends_at, note, reward_user_id, reward_points)
         values ($1, 'amount', $2, 1, now() + make_interval(days => $3::int), $4, $5, $6) returning ends_at`,
        [code, valueCents, CODE_VALID_DAYS, `Rewards: ${points} points`, userId, points],
        tx,
      );
      return { code, valueCents, points, endsAt: made!.ends_at, balance: spent.balance };
    });
  }

  /** A short code the customer types into another app to link it to this account. */
  async linkCode(userId: string) {
    await this.db.exec(
      'delete from public.reward_link_codes where user_id = $1 or expires_at < now()',
      [userId],
    );
    const raw = randomCode(8);
    const made = await this.db.one<{ expires_at: string }>(
      `insert into public.reward_link_codes (code_hash, user_id, expires_at)
       values ($1, $2, now() + make_interval(mins => $3::int)) returning expires_at`,
      [sha(raw), userId, LINK_CODE_MINUTES],
    );
    return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: made!.expires_at };
  }

  /** Stops an app giving or spending this account's points. Its history stays. */
  async unlink(userId: string, app: string) {
    const row = await this.db.one(
      `update public.reward_links set unlinked_at = now()
        where user_id = $1 and app = $2 and unlinked_at is null returning id`,
      [userId, app],
    );
    if (!row) throw notFound('Linked app');
  }

  // ---------- connected apps ----------

  /** The app a key belongs to, when the key is right and the app is switched on. */
  async authenticateApp(key: string): Promise<RewardApp | null> {
    if (!key.startsWith(KEY_PREFIX) || key.length > 200) return null;
    const app = await this.db.one<RewardApp>(
      `select slug, name, daily_cap, active, created_at, last_used_at from public.reward_apps
        where key_hash = $1 and active`,
      [sha(key)],
    );
    if (app)
      await this.db.exec(
        `update public.reward_apps set last_used_at = now()
          where slug = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')`,
        [app.slug],
      );
    return app;
  }

  /** Trades a customer's link code for a member id this app uses from then on. Linking twice gives the same id. */
  async link(app: RewardApp, rawCode: string) {
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const taken = code
      ? await this.db.one<{ user_id: string }>(
          'delete from public.reward_link_codes where code_hash = $1 and expires_at > now() returning user_id',
          [sha(code)],
        )
      : null;
    if (!taken)
      throw new AppError(
        'That code is wrong or has run out. Make a new one in your Spin Hobby account.',
        404,
        'BAD_LINK_CODE',
      );
    const link =
      (await this.db.one<{ id: string }>(
        `insert into public.reward_links (app, user_id) values ($1, $2)
         on conflict (app, user_id) where unlinked_at is null do nothing returning id`,
        [app.slug, taken.user_id],
      )) ??
      (await this.db.one<{ id: string }>(
        'select id from public.reward_links where app = $1 and user_id = $2 and unlinked_at is null',
        [app.slug, taken.user_id],
      ));
    return { memberId: link!.id, ...(await this.memberView(taken.user_id)) };
  }

  private async memberView(userId: string, tx?: Queryable) {
    const [balance, settings, profile] = await Promise.all([
      this.balance(userId, tx),
      this.settings(tx),
      this.db.one<{ first_name: string | null }>(
        'select first_name from public.profiles where id = $1',
        [userId],
        tx,
      ),
    ]);
    return {
      balance,
      worthCents: pointsValueCents(balance, settings.centsPer100Points),
      firstName: profile?.first_name ?? null,
      enabled: settings.enabled,
    };
  }

  private async member(app: RewardApp, memberId: string, tx?: Queryable) {
    const row = /^[0-9a-f-]{36}$/i.test(memberId)
      ? await this.db.one<{ user_id: string }>(
          'select user_id from public.reward_links where id = $1 and app = $2 and unlinked_at is null',
          [memberId, app.slug],
          tx,
        )
      : null;
    if (!row)
      throw new AppError(
        'This member has unlinked this app, or never linked it.',
        404,
        'NOT_LINKED',
      );
    return row.user_id;
  }

  /** A linked member's balance, for the app to show. */
  async memberBalance(app: RewardApp, memberId: string) {
    return this.memberView(await this.member(app, memberId));
  }

  /** The app gives points, up to its daily cap per member. Sending the same `ref` again counts once. */
  async award(
    app: RewardApp,
    memberId: string,
    input: { points: number; reason: string; ref: string },
  ) {
    return this.db.transaction(async (tx) => {
      const userId = await this.member(app, memberId, tx);
      if (!(await this.settings(tx)).enabled) throw OFF();
      const today = await this.db.one<{ points: number }>(
        `select coalesce(sum(points), 0)::int as points from public.reward_entries
          where user_id = $1 and app = $2 and points > 0 and created_at > now() - interval '1 day' and ref is distinct from $3`,
        [userId, app.slug, input.ref],
        tx,
      );
      if (Number(today?.points ?? 0) + input.points > app.daily_cap)
        throw new AppError(
          `${app.name} can give up to ${app.daily_cap} points a day to one person.`,
          429,
          'DAILY_CAP',
        );
      const done = await this.post(
        { userId, app: app.slug, points: input.points, reason: input.reason, ref: input.ref },
        tx,
      );
      return { balance: done.balance, duplicate: done.duplicate };
    });
  }

  /** The app spends points (an in-app unlock, say). Refused when the balance doesn't cover it. */
  async spend(
    app: RewardApp,
    memberId: string,
    input: { points: number; reason: string; ref: string },
  ) {
    return this.db.transaction(async (tx) => {
      const userId = await this.member(app, memberId, tx);
      if (!(await this.settings(tx)).enabled) throw OFF();
      const done = await this.post(
        { userId, app: app.slug, points: -input.points, reason: input.reason, ref: input.ref },
        tx,
      );
      return { balance: done.balance, duplicate: done.duplicate };
    });
  }

  // ---------- the owner ----------

  async overview() {
    const [settings, apps, totals, recent] = await Promise.all([
      this.settings(),
      this.db.many<RewardApp & { members: number }>(
        `select a.slug, a.name, a.daily_cap, a.active, a.created_at, a.last_used_at,
                (select count(*)::int from public.reward_links l where l.app = a.slug and l.unlinked_at is null) as members
           from public.reward_apps a order by a.created_at`,
      ),
      this.db.one<{ outstanding: number; members: number; earned30: number; spent30: number }>(
        `select (select coalesce(sum(points), 0)::int from public.reward_balances where points > 0) as outstanding,
                (select count(*)::int from public.reward_balances where points > 0) as members,
                (select coalesce(sum(points), 0)::int from public.reward_entries where points > 0 and created_at > now() - interval '30 days') as earned30,
                (select coalesce(-sum(points), 0)::int from public.reward_entries where points < 0 and created_at > now() - interval '30 days') as spent30`,
      ),
      this.db.many<{
        id: string;
        email: string | null;
        app: string;
        points: number;
        reason: string;
        created_at: string;
      }>(
        `select e.id, p.email, e.app, e.points, e.reason, e.created_at
           from public.reward_entries e left join public.profiles p on p.id = e.user_id
          order by e.created_at desc limit 50`,
      ),
    ]);
    const outstanding = Number(totals?.outstanding ?? 0);
    return {
      settings,
      apps: apps.map((a) => ({ ...a, members: Number(a.members) })),
      totals: {
        outstandingPoints: outstanding,
        outstandingCents: pointsValueCents(outstanding, settings.centsPer100Points),
        members: Number(totals?.members ?? 0),
        earned30: Number(totals?.earned30 ?? 0),
        spent30: Number(totals?.spent30 ?? 0),
      },
      recent: recent.map((r) => ({ ...r, points: Number(r.points) })),
    };
  }

  /** Lets another app give and spend points. The key is shown once; only its hash is kept. */
  async createApp(
    adminId: string,
    input: { slug: string; name: string; dailyCap?: number | null },
  ) {
    const slug = input.slug.trim().toLowerCase();
    if (!/^[a-z0-9-]{2,32}$/.test(slug) || slug === 'shop' || slug === 'admin')
      throw new AppError(
        'A short name is 2 to 32 lowercase letters, numbers or -, and not "shop" or "admin".',
      );
    const key = KEY_PREFIX + randomBytes(32).toString('base64url');
    const app = await this.db.one<RewardApp>(
      `insert into public.reward_apps (slug, name, key_hash, daily_cap, created_by) values ($1, $2, $3, $4, $5)
       on conflict (slug) do nothing
       returning slug, name, daily_cap, active, created_at, last_used_at`,
      [slug, input.name.trim(), sha(key), input.dailyCap ?? 500, adminId],
    );
    if (!app) throw new AppError(`There's already an app called ${slug}.`, 409);
    return { app, key };
  }

  async updateApp(slug: string, changes: { name?: string; dailyCap?: number; active?: boolean }) {
    const app = await this.db.one<RewardApp>(
      `update public.reward_apps set name = coalesce($2, name), daily_cap = coalesce($3, daily_cap), active = coalesce($4, active)
        where slug = $1 returning slug, name, daily_cap, active, created_at, last_used_at`,
      [slug, changes.name?.trim() || null, changes.dailyCap ?? null, changes.active ?? null],
    );
    if (!app) throw notFound('App');
    return app;
  }

  /** A new key for an app; the old one stops working at once. */
  async newKey(slug: string) {
    const key = KEY_PREFIX + randomBytes(32).toString('base64url');
    const app = await this.db.one(
      'update public.reward_apps set key_hash = $2 where slug = $1 returning slug',
      [slug, sha(key)],
    );
    if (!app) throw notFound('App');
    return { key };
  }

  /** The owner gives or takes points by hand (a goodwill gesture, a correction). Taking never goes below zero. */
  async adjust(adminId: string, input: { email: string; points: number; reason: string }) {
    const profile = await this.db.one<{ id: string }>(
      'select id from public.profiles where lower(email) = lower($1)',
      [input.email.trim()],
    );
    if (!profile) throw notFound('Account with that email');
    return this.db.transaction(async (tx) => {
      const done = await this.post(
        {
          userId: profile.id,
          app: 'admin',
          points: input.points,
          reason: input.reason,
          createdBy: adminId,
        },
        tx,
      );
      return { balance: done.balance };
    });
  }
}
