import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';

/** Puts one of a product's Square photos on the website or takes it off (it stays in Square). */
export class WebsitePhotoDto {
  @Rule((value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 200)
      throw new AppError("Send the photo's Square id.");
    return value.trim();
  })
  id!: string;

  @Rule((value) => {
    if (typeof value !== 'boolean') throw new AppError('"onWebsite" must be true or false.');
    return value;
  })
  onWebsite!: boolean;
}
