/**
 * An error whose message is safe to show to the shopper/staff member.
 * Anything else that escapes a handler becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Readable text for a caught value of unknown type (for log messages). */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return 'unknown error';
  }
}

export const unauthorized = () => new AppError('Sign in is required.', 401);
export const forbidden = (what = 'perform this action') =>
  new AppError(`You do not have permission to ${what}.`, 403);
export const notFound = (what: string) => new AppError(`${what} not found.`, 404);
