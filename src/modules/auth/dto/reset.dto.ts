import { EmailAddress, Rule } from '../../../common/validation/decorators.js';
import { validateRedirect } from '../redirect.js';

export class ResetDto {
  @EmailAddress()
  email!: string;

  /** Where the reset link should land. Must be one of our own sites (or localhost); optional. */
  @Rule((value) => {
    const target = typeof value === 'string' ? value.slice(0, 500) : '';
    return target ? validateRedirect(target) : '';
  })
  redirectTo = '';
}
