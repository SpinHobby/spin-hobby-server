import { EmailAddress, Rule } from '../../../common/validation/decorators.js';
import { NewPassword } from './new-password.js';

/** Optional name: trimmed and cut to 80 characters; anything that isn't text is ignored. */
const shortName = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 80) : '');

export class SignupDto {
  @EmailAddress()
  email!: string;

  /** At least 8 characters. */
  @NewPassword()
  password!: string;

  @Rule(shortName)
  firstName = '';

  @Rule(shortName)
  lastName = '';
}
