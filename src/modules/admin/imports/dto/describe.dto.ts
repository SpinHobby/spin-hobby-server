import { AppError } from '../../../../common/errors.js';
import { OptionalText, Provided, Rule, Text } from '../../../../common/validation/decorators.js';

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

/** Applying a proposal: the description as a person left it, and optionally the series and maker. */
export class ApplyDescriptionDto {
  @Text('description', 4000)
  description!: string;

  /** Left out: the series stays as it is. Blank: the product has none. */
  @Provided()
  @OptionalText(120)
  series?: string | null;

  /** Left out: the maker stays as it is. Blank: none. */
  @Provided()
  @OptionalText(120)
  manufacturer?: string | null;
}
