import { AppError } from '../../common/errors.js';
import { originAllowed } from '../../config/app.config.js';

/** Only ever redirect to one of our own sites or localhost (used for OAuth and password-reset links alike). */
export function validateRedirect(target: string): string {
  let origin: string;
  try {
    origin = new URL(target).origin;
  } catch {
    throw new AppError('Invalid redirectTo.');
  }
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!originAllowed(origin) && !local) throw new AppError('redirectTo is not an allowed site.');
  return target;
}
