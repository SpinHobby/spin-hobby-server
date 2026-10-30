import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../../common/errors.js';
import { Db } from '../../database/db.service.js';
import type { StorefrontProductRow } from '../../database/rows.js';
import { EmailService } from '../../integrations/email/email.service.js';

export type SavedLine = { variationId: string; quantity: number };

/** A cart is reminded about once it has sat this long without being paid for... */
export const REMIND_AFTER_HOURS = 3;
/** ...and never once it is older than this (a stale cart isn't worth an email). */
export const FORGET_AFTER_DAYS = 7;

/**
 * "Email me my cart if I don't finish": a box the shopper ticks at checkout (never ticked for them). One reminder REMIND_AFTER_HOURS
 * later, with what's still for sale, a link that opens the same cart again and a link to stop these emails. No reminder when the
 * same email has paid for an order since, or said stop.
 */
@Injectable()
export class CartReminderService {
  private readonly logger = new Logger(CartReminderService.name);

  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
  ) {}

  /** Saves (or replaces) this email's cart; an empty cart or an unticked box removes it. */
  async save(email: string, lines: SavedLine[]) {
    if (!lines.length) {
      await this.db.exec('delete from public.cart_reminders where email = $1', [email]);
      return { saved: false };
    }
    if (await this.db.one('select 1 from public.email_opt_outs where email = $1', [email])) {
      // they said stop before; ticking the box again is a new yes
      await this.db.exec('delete from public.email_opt_outs where email = $1', [email]);
    }
    await this.db.exec(
      `insert into public.cart_reminders (email, lines, updated_at, reminded_at) values ($1, $2::jsonb, now(), null)
       on conflict (email) do update set lines = excluded.lines, updated_at = now(), reminded_at = null`,
      [email, JSON.stringify(lines)],
    );
    return { saved: true };
  }

  /** The products and quantities of a saved cart, for the link in the email; only what's still for sale. */
  async open(token: string) {
    const row = await this.db.one<{ lines: SavedLine[] }>(
      'select lines from public.cart_reminders where token = $1',
      [token],
    );
    if (!row) throw new AppError('This cart link has expired.', 404);
    return this.products(row.lines);
  }

  /** Stops cart reminders for the email behind `token`, now and later. */
  async stop(token: string) {
    const row = await this.db.one<{ email: string }>(
      'delete from public.cart_reminders where token = $1 returning email',
      [token],
    );
    if (!row) return false;
    await this.db.exec(
      'insert into public.email_opt_outs (email) values ($1) on conflict do nothing',
      [row.email],
    );
    return true;
  }

  /** Sends the reminders that are due. Returns how many went out. */
  async sendDue(now = new Date()) {
    // saved carts are kept FORGET_AFTER_DAYS at most (the privacy policy says so), reminded or not
    await this.db.exec(
      `delete from public.cart_reminders where updated_at < $1::timestamptz - make_interval(days => $2)`,
      [now.toISOString(), FORGET_AFTER_DAYS],
    );
    if (!this.email.configured) return 0;
    const due = await this.db.many<{ email: string; lines: SavedLine[]; token: string }>(
      `select r.email, r.lines, r.token from public.cart_reminders r
        where r.reminded_at is null
          and r.updated_at < $1::timestamptz - make_interval(hours => $2)
          and r.updated_at > $1::timestamptz - make_interval(days => $3)
          and not exists (select 1 from public.email_opt_outs x where x.email = r.email)
          and not exists (select 1 from public.orders o where o.billing_email = r.email and o.paid_at >= r.updated_at)
        order by r.updated_at
        limit 50`,
      [now.toISOString(), REMIND_AFTER_HOURS, FORGET_AFTER_DAYS],
    );
    let sent = 0;
    for (const r of due) {
      const items = await this.products(r.lines);
      // mark first, so a crash or a slow mail provider can never send the same reminder twice
      await this.db.exec('update public.cart_reminders set reminded_at = $2 where email = $1', [
        r.email,
        now.toISOString(),
      ]);
      if (!items.length) continue; // everything sold out since: nothing to remind about
      const ok = await this.email
        .send(
          r.email,
          'You left something in your Spin Hobby cart',
          this.email.cartReminderHtml(items, r.token),
        )
        .catch(() => false);
      if (ok) sent++;
    }
    if (sent) this.logger.log(`Sent ${sent} cart reminder${sent === 1 ? '' : 's'}.`);
    return sent;
  }

  private async products(lines: SavedLine[]) {
    const quantities = new Map(lines.map((l) => [l.variationId, l.quantity]));
    const rows = await this.db.many<StorefrontProductRow>(
      `select * from public.storefront_products p
        where p.variation_id = any($1::text[]) and p.status in ('in', 'low', 'pre') and p.price_cents > 0`,
      [[...quantities.keys()]],
    );
    return rows.map((product) => ({
      product,
      quantity: quantities.get(product.variation_id!) ?? 1,
    }));
  }
}
