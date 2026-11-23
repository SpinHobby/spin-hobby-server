import { AppError } from '../../../../common/errors.js';
import { OptionalText, Provided, Rule, Text } from '../../../../common/validation/decorators.js';
import { categoryId } from '../../categories/category-id.js';

/** The parts of a product a describe job can redo; "details" is the series, the maker and the product line. */
export const DESCRIBE_PARTS = ['title', 'description', 'details', 'category'] as const;
export type DescribePart = (typeof DESCRIBE_PARTS)[number];

/** Which products to describe: the ones picked, or every product shoppers can see that has no description yet. */
export class DescribeBatchDto {
  @Rule((v) => {
    if (v === undefined || v === null) return null;
    if (
      !Array.isArray(v) ||
      v.length > 2000 ||
      v.some((x) => typeof x !== 'string' || !x || x.length > 100)
    )
      throw new AppError('ids must be a list of product ids.');
    return v;
  })
  ids: string[] | null = null;

  /** Every visible product without a real description (ignored when ids are given). */
  @Rule((v) => v === true || v === 'true')
  missing = false;

  /**
   * Which parts the person wants redone (title, description, details = series and maker, category); the review ticks these
   * first. Left out: the description (and the details), as the Descriptions screen asks.
   */
  @Rule((v) => {
    if (v === undefined || v === null) return null;
    if (
      !Array.isArray(v) ||
      !v.length ||
      v.some((x) => !(DESCRIBE_PARTS as readonly unknown[]).includes(x))
    )
      throw new AppError(`parts must be some of: ${DESCRIBE_PARTS.join(', ')}.`);
    return [...new Set(v as DescribePart[])];
  })
  parts: DescribePart[] | null = null;

  /** At most this many products in one go (default 200, up to 2000). */
  @Rule((v) => {
    if (v === undefined || v === null || v === '') return 200;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 2000)
      throw new AppError('limit must be a whole number from 1 to 2000.');
    return n;
  })
  limit = 200;
}

/** What the app proposes for a product. Every part is optional except the description; lists are short. */
export class DescribeResultDto {
  @Rule((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
      throw new AppError('result must be an object.');
    return v;
  })
  result!: Record<string, unknown>;
}

/**
 * Applying a proposal: the parts a person chose, as they left them. Each part left out stays as the product has it; at least one
 * part must be sent.
 */
export class ApplyDescriptionDto {
  /** Left out: the description stays as it is. */
  @Provided()
  @Text('description', 4000)
  description?: string;

  /** The product's name (Square's item name). Left out: it stays as it is. */
  @Provided()
  @Text('title', 255)
  title?: string;

  /** A shop category id. Left out: the category stays as it is; null or blank: no category. */
  @Provided()
  @Rule((value) => categoryId(value))
  category_id?: string | null;

  /** Left out: the series stays as it is. Blank: the product has none. */
  @Provided()
  @OptionalText(120)
  series?: string | null;

  /** Left out: the maker stays as it is. Blank: none. */
  @Provided()
  @OptionalText(120)
  manufacturer?: string | null;

  /** The product line. Left out: it stays as it is. Blank: none. */
  @Provided()
  @OptionalText(120)
  product_line?: string | null;
}
