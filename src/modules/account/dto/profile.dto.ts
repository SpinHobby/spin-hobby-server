import { AppError } from '../../../common/errors.js';
import { Provided, Rule } from '../../../common/validation/decorators.js';
import { normalizePostal } from '../../shipping/shipping-math.js';

/** A name as typed, at most 80 characters; empty clears it. */
const optionalName = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null;
/** A phone number as people type it: digits with + ( ) - . and spaces; empty clears it. */
export const phoneValue = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const text = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  const digits = text.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(text) || digits.length < 7 || digits.length > 15)
    throw new AppError('Enter a phone number like 416 555 0123.');
  return text;
};

/** A shipping address saved for next time (checkout fills it in). */
export interface SavedAddress {
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: 'CA' | 'US';
}

const line = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** The welcome step's address: all of it or none of it (an empty street means "no address"). */
export const addressValue = (v: unknown): SavedAddress | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object')
    throw new AppError('Enter the address as street, city, province and postal code.');
  const a = v as Record<string, unknown>;
  const address1 = line(a.address1);
  if (!address1) return null;
  const country = a.country === 'US' ? 'US' : a.country === 'CA' ? 'CA' : null;
  if (!country) throw new AppError('We ship to Canada and the United States.');
  const city = line(a.city, 80);
  if (!city) throw new AppError('Enter the city.');
  const province = line(a.province, 3).toUpperCase();
  if (!/^[A-Z]{2}$/.test(province))
    throw new AppError(country === 'CA' ? 'Choose the province.' : 'Choose the state.');
  const postalCode = normalizePostal(country, a.postalCode);
  if (!postalCode)
    throw new AppError(
      country === 'CA' ? 'Enter the postal code like A1A 1A1.' : 'Enter the ZIP code like 12345.',
    );
  return { address1, address2: line(a.address2) || null, city, province, postalCode, country };
};

/** Month and day, no year (February 29 is allowed). Empty clears it. */
export interface Birthday {
  month: number;
  day: number;
}
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const birthdayValue = (v: unknown): Birthday | null => {
  if (v === null || v === undefined || v === '') return null;
  const b = (typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const month = Number(b.month);
  const day = Number(b.day);
  if (!month && !day) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new AppError('Choose the month of your birthday.');
  if (!Number.isInteger(day) || day < 1 || day > DAYS_IN_MONTH[month - 1])
    throw new AppError('Choose a day that exists in that month.');
  return { month, day };
};

/** The signed-in customer's own details. Only what is sent changes; any save also marks the welcome step as seen. */
export class ProfileDto {
  @Provided()
  @Rule(optionalName)
  firstName?: string | null;

  @Provided()
  @Rule(optionalName)
  lastName?: string | null;

  @Provided()
  @Rule(phoneValue)
  phone?: string | null;

  /** `{ month, day }`; null or empty clears it. */
  @Provided()
  @Rule(birthdayValue)
  birthday?: Birthday | null;

  /** Saved as the customer's default shipping address. Left out or empty: their saved address stays as it is. */
  @Provided()
  @Rule(addressValue)
  address?: SavedAddress | null;
}
