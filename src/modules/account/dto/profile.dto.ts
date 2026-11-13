import { AppError } from '../../../common/errors.js';
import { Provided, Rule } from '../../../common/validation/decorators.js';

const name = (v: unknown) => {
  const text = typeof v === 'string' ? v.trim().slice(0, 80) : '';
  if (!text) throw new AppError('Enter your first name.');
  return text;
};
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

/** The signed-in customer's own details. Only what is sent changes; any save also marks the welcome step as seen. */
export class ProfileDto {
  @Provided()
  @Rule(name)
  firstName?: string;

  @Provided()
  @Rule(optionalName)
  lastName?: string | null;

  @Provided()
  @Rule(phoneValue)
  phone?: string | null;
}
