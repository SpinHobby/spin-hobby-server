import { AppError } from '../../common/errors.js';

/** A packed size field (grams or cm): a whole number from 1 to 100,000, or blank / null to clear it (the category's or shop's is used). */
export function parcelField(field: string) {
  return (value: unknown) => {
    if (value === null || value === '' || value === undefined) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new AppError(`Invalid ${field}.`);
    return n;
  };
}
