import { parcelField } from '../../../shipping/parcel-fields.js';
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

  /** The packed size of one product in this category (grams, cm), for courier rates; subcategories inherit it. Null clears. */
  @Provided()
  @Rule(parcelField('parcelWeightG'))
  parcelWeightG?: number | null;

  @Provided()
  @Rule(parcelField('parcelLengthCm'))
  parcelLengthCm?: number | null;

  @Provided()
  @Rule(parcelField('parcelWidthCm'))
  parcelWidthCm?: number | null;

  @Provided()
  @Rule(parcelField('parcelHeightCm'))
  parcelHeightCm?: number | null;
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

/** Products to put in categories, as a person chose them on the "sort products" screen. */
export class AssignCategoriesDto {
  /** 1 to 3000 pairs of a product's Square item id and a shop category id. */
  @Rule((value) => {
    if (!Array.isArray(value) || !value.length || value.length > 3000)
      throw new AppError('Choose at least one product.');
    return value.map((a) => {
      const pair = a as { id?: unknown; categoryId?: unknown };
      if (typeof pair?.id !== 'string' || !pair.id || pair.id.length > 64)
        throw new AppError('Invalid product.');
      const category = categoryId(pair.categoryId);
      if (!category) throw new AppError('Choose a category for every product.');
      return { id: pair.id, categoryId: category };
    });
  })
  assignments!: { id: string; categoryId: string }[];
}
