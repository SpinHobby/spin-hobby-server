import { AppError } from '../../common/errors.js';

/** A price typed in dollars ("12.50") as whole cents. Must be a number above zero. */
export function dollarsToCents(price: unknown): number {
  const cents = Math.round(Number(price) * 100);
  if (price == null || price === '' || !Number.isFinite(cents) || cents <= 0)
    throw new AppError('price must be a positive number');
  return cents;
}
