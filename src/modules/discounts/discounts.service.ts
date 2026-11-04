import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../common/errors.js';
import { Db, type Queryable } from '../../database/db.service.js';
import { normalizeCode, type DiscountRule } from './discount-math.js';

export interface DiscountCodeRow extends DiscountRule {
  id: string;
  note: string | null;
  created_at: string;
}

export interface DiscountCodeInput {
  code: string;
  kind: 'percent' | 'amount';
  value: number;
  minSubtotalCents?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  maxUses?: number | null;
  note?: string | null;
}

/** Discount codes: looked up at checkout, counted when paid, managed by the owner (Admin > Discount codes). */
@Injectable()
export class DiscountsService {
  constructor(private readonly db: Db) {}

  /** The code as typed (any capitals or spaces), or null. */
  find(raw: string, tx?: Queryable) {
    return this.db.one<DiscountCodeRow>(
      'select * from public.discount_codes where code = $1',
      [normalizeCode(raw)],
      tx,
    );
  }

  /** One more paid order used this code. */
  async countUse(code: string, tx?: Queryable) {
    await this.db.exec(
      'update public.discount_codes set uses = uses + 1 where code = $1',
      [code],
      tx,
    );
  }

  list() {
    return this.db.many<DiscountCodeRow>(
      'select * from public.discount_codes order by active desc, created_at desc limit 500',
    );
  }

  async create(adminId: string, input: DiscountCodeInput, tx?: Queryable) {
    const code = normalizeCode(input.code);
    if (!/^[A-Z0-9_-]{3,32}$/.test(code))
      throw new AppError('A code is 3 to 32 letters, numbers, - or _.');
    if (input.kind === 'percent' && input.value > 100)
      throw new AppError('A percentage is at most 100.');
    if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt))
      throw new AppError('The end date must be after the start date.');
    if (await this.find(code, tx)) throw new AppError(`There's already a code ${code}.`);
    return this.db.one<DiscountCodeRow>(
      `insert into public.discount_codes (code, kind, value, min_subtotal_cents, starts_at, ends_at, max_uses, note, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        code,
        input.kind,
        input.value,
        input.minSubtotalCents ?? 0,
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.maxUses ?? null,
        input.note ?? null,
        adminId,
      ],
      tx,
    );
  }

  /** Switches a code on or off, or changes its end date, cap or note. The code, kind and value stay as they were sold. */
  async update(
    id: string,
    changes: {
      active?: boolean;
      endsAt?: string | null;
      maxUses?: number | null;
      note?: string | null;
    },
  ) {
    const row = await this.db.one<DiscountCodeRow>(
      `update public.discount_codes set
          active = coalesce($2, active),
          ends_at = case when $3 then $4::timestamptz else ends_at end,
          max_uses = case when $5 then $6::int else max_uses end,
          note = case when $7 then $8 else note end
        where id = $1 returning *`,
      [
        id,
        changes.active ?? null,
        'endsAt' in changes,
        changes.endsAt ?? null,
        'maxUses' in changes,
        changes.maxUses ?? null,
        'note' in changes,
        changes.note ?? null,
      ],
    );
    if (!row) throw notFound('Discount code');
    return row;
  }
}
