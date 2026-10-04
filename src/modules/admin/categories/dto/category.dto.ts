import { AppError } from '../../../../common/errors.js';
import { Provided, Rule } from '../../../../common/validation/decorators.js';
import { stringValue } from '../../../../common/validation/rules.js';
import { categoryId, isUuid } from '../category-id.js';

/** A category name: required, at most 80 characters, with runs of spaces squeezed to one. */
const categoryName = (value: unknown) => stringValue(value, 'name', 80).replace(/\s+/g, ' ');

/** A new shop category. */
export class CreateCategoryDto {
  /** The parent category's id, or null for a top-level category. */
  @Rule(categoryId)
  parentId: string | null = null;

  @Rule(categoryName)
  name!: string;

  /** Visible unless explicitly `false`. */
  @Rule((v) => v !== false)
  isVisible = true;
}

/** Changes to a category: any subset. Fields that aren't sent are left alone. */
export class UpdateCategoryDto {
  @Provided()
  @Rule(categoryName)
  name?: string;

  @Provided()
  @Rule((v) => v === true)
  isVisible?: boolean;

  /** Moves the category under another one, or to the top level with null. It can't go inside itself. */
  @Provided()
  @Rule(categoryId)
  parentId?: string | null;
}

/** Category ids in the order they should appear. */
export class ReorderCategoriesDto {
  @Rule((value) => {
    if (!Array.isArray(value) || value.length > 500 || value.some((id) => !isUuid(id)))
      throw new AppError('ids is required.');
    return value;
  })
  ids!: string[];
}
