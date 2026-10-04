import { AppError } from '../../../../common/errors.js';
import { optionalString, stringValue } from '../../../../common/validation/rules.js';
import { env } from '../../../../config/env.js';

/** A price in cents: a whole number above 0 and at most $100,000. */
export function priceCents(value: unknown) {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 10_000_000)
    throw new AppError('Enter a price above $0.');
  return cents;
}

/** null / '' = untracked (unlimited), otherwise a whole number of units. */
export function stock(value: unknown) {
  if (value === null || value === '' || value === undefined) return null;
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 0 || qty > 100_000)
    throw new AppError('Stock must be a whole number of 0 or more.');
  return qty;
}

/** Up to 8 photo URLs. Production needs https; local development may use the API's own /uploads on localhost. */
export function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new AppError('Add up to 8 photos.');
  return value.map((url) => {
    const text = stringValue(url, 'image URL', 1000);
    const localDev =
      env('NODE_ENV') !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(text);
    if (!/^https:\/\//.test(text) && !localDev)
      throw new AppError('Photo URLs must start with https://');
    return text;
  });
}

/** A date or month as `YYYY-MM` or `YYYY-MM-DD`, or null when blank. */
export function dateOrMonth(value: unknown, field: string) {
  const text = optionalString(value, 30);
  if (text && !/^\d{4}-\d{2}(-\d{2})?/.test(text)) throw new AppError(`Invalid ${field}.`);
  return text;
}
