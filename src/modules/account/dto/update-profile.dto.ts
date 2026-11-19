import { OptionalText } from '../../../common/validation/decorators.js';

/** `PUT /account/profile`: the shopper's own name. Blank or missing clears it. */
export class UpdateProfileDto {
  @OptionalText(80)
  firstName: string | null = null;

  @OptionalText(80)
  lastName: string | null = null;
}
