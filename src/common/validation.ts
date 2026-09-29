import { AppError } from './errors.js';

// Ported 1:1 from supabase/functions/_shared/http.ts so both servers reject the same input
// with the same messages.

export type Json = Record<string, unknown>;

export function jsonBody(body: unknown): Json {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('Expected a JSON object.');
  return body as Json;
}

export function stringValue(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new AppError(`${field} is required.`);
  }
  return value.trim();
}

export function optionalString(value: unknown, maxLength = 500): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new AppError('Invalid text value.');
  return value.trim();
}

export function positiveInteger(value: unknown, field: string, max = 99): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new AppError(`${field} must be between 1 and ${max}.`);
  return number;
}

export function email(value: unknown): string {
  const address = stringValue(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new AppError('Enter a valid email address.');
  return address;
}

/** Escapes LIKE wildcards; the value itself is always passed as a bound parameter. */
export function likePattern(value: string): string {
  return `%${value.slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function nonNegativeIntOrNull(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new AppError(`Invalid ${field}.`);
  return n;
}
