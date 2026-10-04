import { AppError } from '../../../common/errors.js';
import { Rule } from '../../../common/validation/decorators.js';
import { stringValue } from '../../../common/validation/rules.js';
import { validateRedirect } from '../redirect.js';

export const OAUTH_PROVIDERS = ['google', 'discord'] as const;

export class OauthUrlQuery {
  /** `google` or `discord`. */
  @Rule((value) => {
    if (!OAUTH_PROVIDERS.includes(value as (typeof OAUTH_PROVIDERS)[number]))
      throw new AppError('Unknown sign-in provider.');
    return value;
  })
  provider!: string;

  /** Where Supabase sends the browser back to after sign-in. Must be one of our own sites (or localhost). */
  @Rule((value) => validateRedirect(stringValue(value, 'redirectTo', 500)))
  redirectTo!: string;
}
