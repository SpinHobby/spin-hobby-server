import { AppError } from '../../../common/errors.js';
import { Provided, Rule } from '../../../common/validation/decorators.js';
import { boolValue, email, optionalString, stringValue } from '../../../common/validation/rules.js';

const whole = (field: string, min: number, max: number) => (v: unknown) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
    throw new AppError(
      `${field} must be a whole number from ${min.toLocaleString('en-CA')} to ${max.toLocaleString('en-CA')}.`,
    );
  return n;
};
const ref = (v: unknown) => {
  if (typeof v !== 'string' || !/^[\w.:@/-]{1,200}$/.test(v.trim()))
    throw new AppError(
      'ref is your own id for this event: 1 to 200 letters, numbers or . : @ / - _',
    );
  return v.trim();
};

const wholeOrNull = (field: string, max: number) => (v: unknown) =>
  v == null || v === '' || v === 0 ? null : whole(field, 1, max)(v);

/** Turn points into a one-time discount code. */
export class RedeemDto {
  @Rule(whole('points', 1, 10_000_000))
  points!: number;
}

/** A customer's link code, typed into the app (XXXX-XXXX; dashes, spaces and case don't matter). */
export class LinkAppDto {
  @Rule((v) => stringValue(v, 'code', 20))
  code!: string;
}

/** An app gives or spends points. `ref` is the app's own id for the event, so a retry counts once. */
export class AppPointsDto {
  @Rule(whole('points', 1, 10_000))
  points!: number;

  @Rule((v) => stringValue(v, 'reason', 200))
  reason!: string;

  @Rule(ref)
  ref!: string;
}

export class RewardSettingsDto {
  @Provided()
  @Rule((v) => boolValue(v, 'enabled'))
  enabled?: boolean;

  @Provided()
  @Rule(whole('pointsPerDollar', 0, 100))
  pointsPerDollar?: number;

  @Provided()
  @Rule(whole('centsPer100Points', 1, 10_000))
  centsPer100Points?: number;

  @Provided()
  @Rule(whole('minRedeemPoints', 100, 1_000_000))
  minRedeemPoints?: number;

  /** Days after an order ships before its points can be used (the return window). */
  @Provided()
  @Rule(whole('returnWindowDays', 0, 90))
  returnWindowDays?: number;
}

/** How one product earns: `multiplier` 2 = double points, 0 = none, 1 = normal; an optional end for a promotion. */
export class ProductRuleDto {
  @Rule((v) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10)
      throw new AppError('multiplier must be a number from 0 (no points) to 10.');
    return Math.round(n * 100) / 100;
  })
  multiplier!: number;

  @Rule((v) => {
    if (v == null || v === '') return null;
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v)))
      throw new AppError('endsAt must be a date.');
    return new Date(v).toISOString();
  })
  endsAt: string | null = null;

  @Rule((v) => optionalString(v, 200))
  note: string | null = null;

  /** Only customers with this many points from past orders can buy it (empty: anyone). */
  @Rule(wholeOrNull('minEarnedPoints', 1_000_000))
  minEarnedPoints: number | null = null;

  /** The same order must also have this much (cents) of other products (empty: no need). */
  @Rule(wholeOrNull('minOtherCents', 100_000_000))
  minOtherCents: number | null = null;
}

export class CreateRewardAppDto {
  /** A short id for the app, e.g. `hangout` (lowercase letters, numbers, -). */
  @Rule((v) => stringValue(v, 'slug', 32))
  slug!: string;

  @Rule((v) => stringValue(v, 'name', 80))
  name!: string;

  /** Most points the app can give one person in a day. */
  @Provided()
  @Rule(whole('dailyCap', 1, 1_000_000))
  dailyCap?: number;
}

export class UpdateRewardAppDto {
  @Provided()
  @Rule((v) => stringValue(v, 'name', 80))
  name?: string;

  @Provided()
  @Rule(whole('dailyCap', 1, 1_000_000))
  dailyCap?: number;

  @Provided()
  @Rule((v) => boolValue(v, 'active'))
  active?: boolean;
}

/** The owner gives (positive) or takes (negative) points by hand. */
export class AdjustPointsDto {
  @Rule((v) => email(v))
  email!: string;

  @Rule((v) => {
    const n = whole('points', -1_000_000, 1_000_000)(v);
    if (n === 0) throw new AppError('points must not be 0.');
    return n;
  })
  points!: number;

  @Rule((v) => stringValue(v, 'reason', 200))
  reason!: string;
}
