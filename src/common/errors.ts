/**
 * An error whose message is safe to show to the shopper/staff member.
 * Anything else that escapes a handler becomes a generic 500.
 */
export class AppError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

export const unauthorized = () => new AppError('Sign in is required.', 401);
export const forbidden = (what = 'perform this action') => new AppError(`You do not have permission to ${what}.`, 403);
export const notFound = (what: string) => new AppError(`${what} not found.`, 404);
