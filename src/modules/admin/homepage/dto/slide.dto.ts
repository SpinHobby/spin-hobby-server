import { AppError } from '../../../../common/errors.js';
import { OptionalText, Provided, Rule, Text } from '../../../../common/validation/decorators.js';
import { OptionalSortOrder, SortOrder } from '../../dto/sort-order.js';
import { backdropValue, optionalMoment, pickedProducts } from '../banner.js';

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

  /** The small tag above the headline ("Pre-orders"). */
  @OptionalText(40)
  label: string | null = null;

  @OptionalText(40)
  buttonText: string | null = null;

  /** The ad shows from here to there; leave one out for no limit on that side. */
  @Rule((v) => optionalMoment(v, 'startsAt'))
  startsAt: string | null = null;

  @Rule((v) => optionalMoment(v, 'endsAt'))
  endsAt: string | null = null;

  /** What shows behind the words: product photos, the photo in `imageUrl`, or the products in `productIds`. */
  @Rule((v) => (v === undefined || v === null ? 'products' : backdropValue(v)))
  backdrop: 'products' | 'photo' | 'chosen' = 'products';

  @Rule((v) => (v === undefined || v === null ? [] : pickedProducts(v)))
  productIds: string[] = [];

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
  @OptionalText(40)
  label?: string | null;

  @Provided()
  @OptionalText(40)
  buttonText?: string | null;

  @Provided()
  @Rule((v) => optionalMoment(v, 'startsAt'))
  startsAt?: string | null;

  @Provided()
  @Rule((v) => optionalMoment(v, 'endsAt'))
  endsAt?: string | null;

  @Provided()
  @Rule((v) => backdropValue(v))
  backdrop?: 'products' | 'photo' | 'chosen';

  @Provided()
  @Rule((v) => pickedProducts(v))
  productIds?: string[];

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
