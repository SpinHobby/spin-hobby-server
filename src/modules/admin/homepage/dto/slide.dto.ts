import { AppError } from '../../../../common/errors.js';
import { OptionalText, Provided, Rule, Text } from '../../../../common/validation/decorators.js';
import { OptionalSortOrder, SortOrder } from '../../dto/sort-order.js';

/** A new homepage banner. */
export class CreateSlideDto {
  @Text('headline', 160)
  headline!: string;

  @OptionalText(300)
  subheading: string | null = null;

  @OptionalText(1000)
  imageUrl: string | null = null;

  @OptionalText(1000)
  linkUrl: string | null = null;

  /** Only an actual `true` shows the banner. */
  @Rule((v) => v === true)
  isVisible = false;

  @SortOrder()
  sortOrder = 0;
}

/** Changes to a banner: any subset; fields that aren't sent are left alone. */
export class UpdateSlideDto {
  @Provided()
  @Text('headline', 160)
  headline?: string;

  @Provided()
  @OptionalText(300)
  subheading?: string | null;

  @Provided()
  @OptionalText(1000)
  imageUrl?: string | null;

  @Provided()
  @OptionalText(1000)
  linkUrl?: string | null;

  @Provided()
  @Rule((v) => v === true)
  isVisible?: boolean;

  /** Ignored unless it is a whole number. */
  @Provided()
  @OptionalSortOrder()
  sortOrder?: number;
}

/** Banner ids in the order they should appear. */
export class ReorderSlidesDto {
  @Rule((value) => {
    if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== 'string'))
      throw new AppError('ids is required.');
    return value;
  })
  ids!: string[];
}
