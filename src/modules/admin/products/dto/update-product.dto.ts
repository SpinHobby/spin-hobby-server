import { AppError } from '../../../../common/errors.js';
import { Provided, Rule } from '../../../../common/validation/decorators.js';
import { categoryId } from '../../categories/category-id.js';

/** An empty string means "clear this field". */
const blankToNull = (value: unknown) => (value === '' ? null : value);

/** Text-like fields are stored as sent (a blank clears them). */
const clearable = (value: unknown) => blankToNull(value);

const wholeNumber = (field: string) => (value: unknown) => {
  const v = blankToNull(value);
  if (v !== null && (!Number.isInteger(Number(v)) || Number(v) < 0))
    throw new AppError(`Invalid ${field}.`);
  return v;
};

/**
 * The storefront details staff can set on any product, Square-sourced or not (these live in our database,
 * not in Square). Any subset may be sent; fields that aren't sent are left alone, and an empty string clears one.
 * Names match the database columns, so the admin drawer can send them as they are.
 */
export class UpdateProductDto {
  /** `auto` (from stock), `preorder`, `backorder` or `hidden`. */
  @Provided()
  @Rule((value) => {
    const v = blankToNull(value);
    if (v && !['auto', 'preorder', 'backorder', 'hidden'].includes(v as string))
      throw new AppError('Invalid availability.');
    return v;
  })
  availability?: 'auto' | 'preorder' | 'backorder' | 'hidden' | null;

  /** First of the month, e.g. `2027-03-01`. */
  @Provided()
  @Rule(clearable)
  release_month?: string | null;

  /** Last moment to order, as a date or timestamp. */
  @Provided()
  @Rule(clearable)
  order_by_date?: string | null;

  @Provided()
  @Rule(clearable)
  series?: string | null;

  @Provided()
  @Rule(clearable)
  character?: string | null;

  @Provided()
  @Rule(clearable)
  manufacturer?: string | null;

  @Provided()
  @Rule(clearable)
  jan_code?: string | null;

  /** The "was" price in cents, shown struck through. */
  @Provided()
  @Rule(wholeNumber('compare_at_cents'))
  compare_at_cents?: number | null;

  @Provided()
  @Rule(wholeNumber('max_per_customer'))
  max_per_customer?: number | null;

  @Provided()
  @Rule(wholeNumber('deposit_cents'))
  deposit_cents?: number | null;

  /** Only an actual `true` features the product on the homepage. */
  @Provided()
  @Rule((value) => value === true)
  is_featured?: boolean;

  /** Position among featured products. */
  @Provided()
  @Rule(wholeNumber('sort_order'))
  sort_order?: number | null;

  /** A shop category id, or null/blank to remove it from its category. */
  @Provided()
  @Rule((value) => categoryId(blankToNull(value)))
  category_id?: string | null;
}
