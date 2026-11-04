import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { envRoleFor, restrictionOf } from '../../auth/auth.service.js';
import { atLeast, rankOf, ROLES, rolesFrom, type AppRole } from '../../auth/roles.js';
import { AdminLog } from '../admin-log.service.js';
import type { AccountsQuery, RestrictionDto } from './dto/accounts.dto.js';

/** The longest suspension: anything longer is a ban. */
const MAX_SUSPENSION_DAYS = 5 * 366;
const SHOP_TIME_ZONE = 'America/Toronto';

interface AccountRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: AppRole;
  can_audit: boolean;
  created_at: string;
  suspended_until: string | null;
  banned_at: string | null;
  restriction_reason: string | null;
  orders: number;
  spent_cents: number;
}

/**
 * Admin > Accounts (owner only): every account, its role and its standing. The owner can change a role, suspend an account until
 * a day, ban it, or lift either. Every change is written to admin_logs. Guard rails: nobody changes their own account, the shop
 * always keeps an owner who can sign in, and a role given by OWNER_EMAILS / STAFF_EMAILS can't be taken away here (it would come
 * back at the next sign-in).
 */
@Injectable()
export class AdminAccountsService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** The roles, lowest first, with what each can do (the Accounts screen builds its choices from this). */
  roles() {
    return ROLES.map((r, rank) => ({ ...r, rank }));
  }

  async list(query: AccountsQuery) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: (n: string) => string, value: unknown) => {
      params.push(value);
      where.push(sql(`$${params.length}`));
    };
    const q = query.q?.trim();
    if (q)
      add(
        (n) =>
          `(p.email ilike ${n} or coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '') ilike ${n})`,
        `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      );
    if (query.role) add((n) => `p.role::text = ${n}`, query.role);
    if (query.status === 'banned') where.push('p.banned_at is not null');
    if (query.status === 'suspended')
      where.push('p.banned_at is null and p.suspended_until > now()');
    if (query.status === 'active')
      where.push(
        'p.banned_at is null and (p.suspended_until is null or p.suspended_until <= now())',
      );
    const filter = where.length ? `where ${where.join(' and ')}` : '';

    const total = await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.profiles p ${filter}`,
      params,
    );
    const rows = await this.db.many<AccountRow>(
      `select p.id, p.email, p.first_name, p.last_name, p.role, p.can_audit, p.created_at,
              p.suspended_until, p.banned_at, p.restriction_reason,
              count(o.id)::int as orders, coalesce(sum(o.total_cents), 0)::int as spent_cents
         from public.profiles p
         left join public.orders o on o.user_id = p.id and o.paid_at is not null
         ${filter}
        group by p.id
        order by array_position($${params.length + 1}::text[], p.role::text) desc nulls last, p.created_at desc
        limit $${params.length + 2} offset $${params.length + 3}`,
      [...params, ROLES.map((r) => r.key), query.limit, query.offset],
    );
    return { total: total?.n ?? 0, accounts: rows.map((r) => this.view(r)) };
  }

  /** One account, with the last changes made to it. */
  async get(id: string) {
    const row = await this.row(id);
    const history = await this.db.many<{
      action: string;
      data: unknown;
      created_at: string;
      by: string | null;
    }>(
      `select l.action, l.data, l.created_at, a.email as by
         from public.admin_logs l left join public.profiles a on a.id = l.admin_id
        where l.target = $1 and (l.action like 'account.%' or l.action like 'audit.access_%')
        order by l.created_at desc limit 50`,
      [id],
    );
    return { ...this.view(row), history };
  }

  /**
   * Everything the account has done in the shop, for the account's drawer: its orders (with items and timeline), favourites,
   * saved addresses and restock alerts. Orders and alerts made as a guest with the account's email count too: the same person,
   * before they signed in.
   */
  async activity(id: string) {
    const { email } = await this.row(id);
    const [orders, favourites, addresses, alerts] = await Promise.all([
      this.db.many<Record<string, unknown>>(
        `select o.id, o.status, o.provider, o.subtotal_cents, o.shipping_cents, o.tax_cents, o.total_cents, o.shipping_method,
                o.shipping_address, o.tracking_number, o.carrier, o.created_at, o.paid_at, o.shipped_at, o.user_id is null as guest,
                coalesce((select json_agg(json_build_object('name', i.name, 'imageUrl', i.image_url, 'unitPriceCents', i.unit_price_cents,
                                                            'quantity', i.quantity, 'preorder', i.is_preorder) order by i.id)
                            from public.order_items i where i.order_id = o.id), '[]') as items,
                coalesce((select json_agg(json_build_object('type', e.event_type, 'at', e.created_at, 'data', e.data) order by e.created_at)
                            from public.order_events e where e.order_id = o.id), '[]') as events,
                coalesce((select sum((e.data ->> 'amount_cents')::int) from public.order_events e
                           where e.order_id = o.id and e.event_type = 'refunded'), 0)::int as refunded_cents
           from public.orders o
          where o.user_id = $1 or (o.user_id is null and o.billing_email = $2)
          order by o.created_at desc limit 200`,
        [id, email],
      ),
      this.db.many<Record<string, unknown>>(
        `select w.square_item_id as id, w.created_at as added_at, p.name, s.price_cents, coalesce(s.status, 'hidden') as status,
                (select pi.image_url from public.product_images pi where pi.square_item_id = w.square_item_id order by pi.sort_order limit 1) as image_url
           from public.wishlist_items w
           join public.catalog_products p on p.square_item_id = w.square_item_id
           left join public.storefront_products s on s.id = w.square_item_id
          where w.user_id = $1
          order by w.created_at desc`,
        [id],
      ),
      this.db.many<Record<string, unknown>>(
        `select id, first_name, last_name, address1, address2, city, province, postal_code, country, phone, is_default, created_at
           from public.customer_addresses where user_id = $1 order by is_default desc, created_at`,
        [id],
      ),
      this.db.many<Record<string, unknown>>(
        `select a.id, a.created_at, a.notified_at, p.name, p.square_item_id as product_id
           from public.stock_alerts a
           join public.catalog_variations v on v.square_variation_id = a.square_variation_id
           join public.catalog_products p on p.square_item_id = v.square_item_id
          where a.user_id = $1 or a.email = $2
          order by a.created_at desc`,
        [id, email],
      ),
    ]);
    const paid = orders.filter((o) => o.paid_at);
    const spent = paid.reduce((t, o) => t + Number(o.total_cents) - Number(o.refunded_cents), 0);
    return {
      summary: {
        orders: orders.length,
        paidOrders: paid.length,
        netSpentCents: spent,
        averageOrderCents: paid.length ? Math.round(spent / paid.length) : 0,
        refunds: orders.filter((o) => Number(o.refunded_cents) > 0).length,
        firstOrderAt: orders.at(-1)?.created_at ?? null,
        lastOrderAt: orders[0]?.created_at ?? null,
        favourites: favourites.length,
        alertsWaiting: alerts.filter((a) => !a.notified_at).length,
      },
      phone: addresses.find((a) => a.phone)?.phone ?? null,
      orders,
      favourites,
      addresses,
      alerts,
    };
  }

  async setRole(ownerId: string, id: string, role: AppRole) {
    const row = await this.changeable(ownerId, id);
    if (row.role === role) return this.view(row);
    const listed = envRoleFor(row.email);
    if (listed && rankOf(role) < rankOf(listed))
      throw new AppError(
        `${row.email} is listed in ${listed === 'owner' ? 'OWNER_EMAILS' : 'STAFF_EMAILS'} on the server, so they'd be ${listed} again at their next sign-in. Remove them from that list first.`,
        409,
        'listed_in_env',
      );
    if (atLeast(row.role, 'owner') && !atLeast(role, 'owner')) await this.keepAnOwner(id);
    const updated = await this.db.transaction(async (tx) => {
      const next = await this.db.one<AccountRow>(
        // Audit access only means something from staff up; it doesn't follow the person down.
        `update public.profiles set role = $2, can_audit = case when $3 then can_audit else false end
          where id = $1 returning *`,
        [id, role, atLeast(role, 'staff')],
        tx,
      );
      await this.log.write(
        ownerId,
        'account.role_changed',
        id,
        { email: row.email, from: row.role, to: role },
        tx,
      );
      return next!;
    });
    return this.view({ ...row, ...updated });
  }

  async restrict(ownerId: string, id: string, dto: RestrictionDto) {
    const row = await this.changeable(ownerId, id);
    const reason = dto.reason?.trim() || null;
    if (dto.action !== 'lift' && atLeast(row.role, 'owner')) await this.keepAnOwner(id);

    let sql: string;
    let params: unknown[];
    let detail: Record<string, unknown>;
    if (dto.action === 'suspend') {
      if (!dto.until) throw new AppError('Choose the last day of the suspension.');
      const days = (Date.parse(dto.until) - Date.now()) / 86_400_000;
      if (days < 0) throw new AppError('The suspension must end after today.');
      if (days > MAX_SUSPENSION_DAYS)
        throw new AppError('For longer than five years, ban the account instead.');
      sql = `update public.profiles set suspended_until = (($2::date + 1)::timestamp at time zone '${SHOP_TIME_ZONE}'),
               banned_at = null, restriction_reason = $3, restricted_by = $4 where id = $1 returning *`;
      params = [id, dto.until, reason, ownerId];
      detail = { email: row.email, until: dto.until, reason };
    } else if (dto.action === 'ban') {
      sql = `update public.profiles set banned_at = now(), suspended_until = null, restriction_reason = $2, restricted_by = $3
              where id = $1 returning *`;
      params = [id, reason, ownerId];
      detail = { email: row.email, reason };
    } else {
      sql = `update public.profiles set banned_at = null, suspended_until = null, restriction_reason = null, restricted_by = null
              where id = $1 returning *`;
      params = [id];
      detail = { email: row.email };
    }
    const action = {
      suspend: 'account.suspended',
      ban: 'account.banned',
      lift: 'account.restriction_lifted',
    }[dto.action];
    const updated = await this.db.transaction(async (tx) => {
      const next = await this.db.one<AccountRow>(sql, params, tx);
      await this.log.write(ownerId, action, id, detail, tx);
      return next!;
    });
    return this.view({ ...row, ...updated });
  }

  private async row(id: string) {
    const row = await this.db.one<AccountRow>(
      `select p.*, (select count(*)::int from public.orders o where o.user_id = p.id and o.paid_at is not null) as orders,
              (select coalesce(sum(total_cents), 0)::int from public.orders o where o.user_id = p.id and o.paid_at is not null) as spent_cents
         from public.profiles p where p.id = $1`,
      [id],
    );
    if (!row) throw notFound('Account');
    return row;
  }

  /** The account, if this owner may change it (never their own). */
  private async changeable(ownerId: string, id: string) {
    if (ownerId === id)
      throw new AppError(
        "You can't change your own account here. Ask another owner.",
        409,
        'own_account',
      );
    return this.row(id);
  }

  /** Refuses a change that would leave the shop without an owner who can sign in. */
  private async keepAnOwner(exceptId: string) {
    const others = await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.profiles
        where role::text = any($1::text[]) and id <> $2
          and banned_at is null and (suspended_until is null or suspended_until <= now())`,
      [rolesFrom('owner'), exceptId],
    );
    if (!others?.n)
      throw new AppError(
        'The shop needs at least one owner who can sign in. Make someone else an owner first.',
        409,
        'last_owner',
      );
  }

  /** What the admin sees: the account, its standing, and whether its role comes from the server's email lists. */
  private view(r: AccountRow) {
    const restriction = restrictionOf(r);
    return {
      id: r.id,
      email: r.email,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
      role: r.role,
      canAudit: atLeast(r.role, 'owner') || (atLeast(r.role, 'staff') && r.can_audit),
      createdAt: r.created_at,
      status: restriction?.kind ?? 'active',
      restriction,
      roleFromEnv: envRoleFor(r.email),
      orders: Number(r.orders ?? 0),
      spentCents: Number(r.spent_cents ?? 0),
    };
  }
}
