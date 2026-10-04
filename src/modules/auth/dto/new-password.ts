import { AppError } from '../../../common/errors.js';
import { Rule } from '../../../common/validation/decorators.js';
import { stringValue } from '../../../common/validation/rules.js';

export const MIN_PASSWORD_LENGTH = 8;

/** A password someone is choosing (sign-up, or after a reset): required, at most 200 characters, at least 8. */
export const NewPassword = () =>
  Rule((value) => {
    const password = stringValue(value, 'password', 200);
    if (password.length < MIN_PASSWORD_LENGTH)
      throw new AppError(`Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`);
    return password;
  });
