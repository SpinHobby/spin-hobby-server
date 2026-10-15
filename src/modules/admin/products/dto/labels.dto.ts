import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';

export class LabelsDto {
  /** Square item ids of the products to make stickers for (1 to 500), in the order they should print. */
  @Rule((value) => {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 500 ||
      value.some((id) => typeof id !== 'string' || !id || id.length > 64)
    )
      throw new AppError('Select between 1 and 500 products.');
    return [...new Set(value as string[])];
  })
  ids!: string[];
}
