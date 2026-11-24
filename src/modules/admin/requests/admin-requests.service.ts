import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import type { StorefrontProductRow } from '../../../database/rows.js';
import { EmailService } from '../../../integrations/email/email.service.js';
import { AdminLog } from '../admin-log.service.js';
import type { AnswerRequestDto } from './dto/answer-request.dto.js';

interface WaitingRow {
  id: string;
  square_item_id: string;
  product_name: string;
  email: string;
  note: string | null;
  created_at: string;
}

/** The "Ask us to find one" requests shoppers left on sold items (item_requests): what is wanted most, and the shop's answer. */
@Injectable()
export class AdminRequestsService {
  constructor(
    private readonly db: Db,
    private readonly email: EmailService,
    private readonly log: AdminLog,
  ) {}

  /** The waiting requests by item, the most wanted first (then the newest ask). */
  async waiting() {
    const rows = await this.db.many<WaitingRow>(
      `select id, square_item_id, product_name, email, note, created_at
         from public.item_requests where status = 'waiting' order by created_at desc`,
    );
    const ids = [...new Set(rows.map((r) => r.square_item_id))];
    const products = ids.length
      ? await this.db.many<StorefrontProductRow>(
          'select * from public.storefront_products where id = any($1::text[])',
          [ids],
        )
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return ids
      .map((id) => {
        const asks = rows.filter((r) => r.square_item_id === id);
        const product = byId.get(id);
        return {
          productId: id,
          // the product's name now, or what it was called when asked (it may be gone)
          name: product?.name ?? asks[0].product_name,
          image: product?.images?.[0] ?? null,
          status: product?.status ?? null,
          count: asks.length,
          latestAt: asks[0].created_at,
          requests: asks.map((r) => ({
            id: r.id,
            email: r.email,
            note: r.note,
            createdAt: r.created_at,
          })),
        };
      })
      .sort((a, b) => b.count - a.count || (a.latestAt < b.latestAt ? 1 : -1));
  }

  /** How many requests wait, for the Admin's menu. */
  async count() {
    const row = await this.db.one<{ count: number }>(
      "select count(*)::int as count from public.item_requests where status = 'waiting'",
    );
    return row?.count ?? 0;
  }

  /** Emails everyone waiting for this item the shop's answer and closes their requests. Returns how many emails went out. */
  async answer(adminId: string, productId: string, dto: AnswerRequestDto) {
    const recipients = await this.db.many<{ id: string; email: string; product_name: string }>(
      `select id, email, product_name from public.item_requests where square_item_id = $1 and status = 'waiting'`,
      [productId],
    );
    if (!recipients.length) throw notFound('Request');
    if (!this.email.configured) throw new AppError('Email is not configured.', 503);
    const listing = dto.found
      ? await this.db.one<StorefrontProductRow>(
          'select * from public.storefront_products where id = $1',
          [dto.buyProductId ?? productId],
        )
      : null;
    if (dto.found && dto.buyProductId && !listing)
      throw new AppError('That listing is not on the shop.');
    if (dto.found && listing && !['in', 'low', 'pre'].includes(listing.status))
      throw new AppError(
        'That listing cannot be bought yet. Put it in stock first, or pick the new listing.',
      );
    const sent: string[] = [];
    for (const r of recipients) {
      const ok = await this.email.send(
        r.email,
        dto.found ? `We found one: ${r.product_name}` : `About your request: ${r.product_name}`,
        this.email.requestAnswerHtml(r.product_name, dto.found, dto.message, listing),
        'news',
      );
      if (ok) sent.push(r.id);
    }
    if (sent.length)
      await this.db.exec(
        `update public.item_requests set status = $2, answer = $3, answered_at = now() where id = any($1::uuid[])`,
        [sent, dto.found ? 'found' : 'not_found', dto.message],
      );
    await this.log.write(adminId, 'request.answered', productId, {
      found: dto.found,
      sent: sent.length,
    });
    return sent.length;
  }
}
