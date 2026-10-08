import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';

export class FrontPageOrderDto {
  /** Square item ids in the order they should appear on the homepage (1 to 200, no repeats). */
  @Rule((value) => {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 200 ||
      value.some((id) => typeof id !== 'string' || !id) ||
      new Set(value).size !== value.length
    )
      throw new AppError('Send between 1 and 200 different products.');
    return value;
  })
  ids!: string[];
}
