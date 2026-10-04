import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';
import { categoryId } from '../../categories/category-id.js';

export class BulkCategoryDto {
  /** Square item ids of the products to move (1 to 500). */
  @Rule((value) => {
    if (
      !Array.isArray(value) ||
      !value.length ||
      value.length > 500 ||
      value.some((id) => typeof id !== 'string')
    )
      throw new AppError('Select at least one product.');
    return value;
  })
  ids!: string[];

  /** The shop category to move them into, or null to clear their category. */
  @Rule(categoryId)
  categoryId: string | null = null;
}
