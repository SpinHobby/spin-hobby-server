import { AppError } from '../../../../common/errors.js';
import { Provided, Rule } from '../../../../common/validation/decorators.js';
import { optionalString, stringValue } from '../../../../common/validation/rules.js';

const date = (field: string) => (v: unknown) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v)))
    throw new AppError(`${field} must be a date.`);
  return new Date(v).toISOString();
};
const wholeOrNull = (field: string, max: number) => (v: unknown) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > max)
    throw new AppError(`${field} must be a whole number from 1 to ${max}.`);
  return n;
};

export class CreateDiscountDto {
  /** What shoppers type, e.g. SPRING10 (3 to 32 letters, numbers, - or _; stored upper-case). */
  @Rule((v) => stringValue(v, 'code', 40))
  code!: string;

  /** `percent` (value is 1 to 100) or `amount` (value is cents). */
  @Rule((v) => {
    if (v === 'percent' || v === 'amount') return v;
    throw new AppError('kind must be percent or amount.');
  })
  kind!: 'percent' | 'amount';

  @Rule((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10_000_000)
      throw new AppError('value must be a whole number above 0.');
    return n;
  })
  value!: number;

  /** The goods must come to at least this (cents) for the code to work. */
  @Rule((v) => (v == null || v === '' ? 0 : Math.max(0, Math.round(Number(v)) || 0)))
  minSubtotalCents = 0;

  @Rule(date('startsAt'))
  startsAt: string | null = null;

  @Rule(date('endsAt'))
  endsAt: string | null = null;

  /** How many paid orders may use it (empty: no limit). */
  @Rule(wholeOrNull('maxUses', 1_000_000))
  maxUses: number | null = null;

  /** For staff only: where the code was given out. */
  @Rule((v) => optionalString(v, 200))
  note: string | null = null;
}

export class UpdateDiscountDto {
  @Provided()
  @Rule((v) => {
    if (typeof v !== 'boolean') throw new AppError('active must be true or false.');
    return v;
  })
  active?: boolean;

  @Provided()
  @Rule(date('endsAt'))
  endsAt?: string | null;

  @Provided()
  @Rule(wholeOrNull('maxUses', 1_000_000))
  maxUses?: number | null;

  @Provided()
  @Rule((v) => optionalString(v, 200))
  note?: string | null;
}
