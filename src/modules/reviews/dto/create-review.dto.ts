import { AppError } from '../../../common/errors.js';
import { OptionalText, Provided, Rule, Text } from '../../../common/validation/decorators.js';
import { email, positiveInteger } from '../../../common/validation/rules.js';

/**
 * A shopper's review of something they bought. Signed in, the order is found from their account; as a guest they give the order
 * number and the email it was placed with (as on the confirmation email).
 */
export class CreateReviewDto {
  /** The product (the `id` field in catalog responses). */
  @Text('itemId', 120)
  itemId!: string;

  /** 1 to 5 stars. */
  @Rule((v) => {
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 5)
      throw new AppError('Pick from 1 to 5 stars.');
    return v;
  })
  rating!: number;

  @OptionalText(120)
  title: string | null = null;

  @Text('review', 2000)
  body!: string;

  /** How the review is signed on the shop, e.g. "Mika T.". */
  @Text('name', 60)
  name!: string;

  /** Guests only: the order number. */
  @Provided()
  @Rule((v) => positiveInteger(v, 'order number', 2_000_000_000))
  orderId?: number;

  /** Guests only: the email the order was placed with. */
  @Provided()
  @Rule((v) => email(v))
  email?: string;
}
