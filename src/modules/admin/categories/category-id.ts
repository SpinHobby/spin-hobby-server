import { AppError } from '../../../common/errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonical UUID such as a shop category id. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** A shop category id, or null for none (null, '' and missing all mean "no category"). */
export function categoryId(value: unknown): string | null {
  if (value === null || value === '' || value === undefined) return null;
  if (!isUuid(value)) throw new AppError('Invalid category.');
  return value;
}
