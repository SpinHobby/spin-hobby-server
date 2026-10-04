import { Expose, Transform } from 'class-transformer';
import { AppError } from '../../../common/errors.js';
import { EmailAddress, Rule } from '../../../common/validation/decorators.js';
import type { QuoteInput } from '../../orders/quote.service.js';
import { cartRequest } from './quote-request.dto.js';

/** A billing or shipping address: any object is accepted and stored as sent. */
const address = (value: unknown) => {
  if (!value || typeof value !== 'object')
    throw new AppError('Billing and shipping addresses are required.');
  return value as Record<string, unknown>;
};

/** What `POST /checkout/intent` takes: the cart, who is buying, and where it goes and is billed. */
export class CheckoutIntentDto {
  /**
   * The cart, in the same shape as `POST /cart/quote`. Also accepted under the older field name `quoteInput`
   * (it wins if both are sent). The two transforms run top to bottom: the alias is copied into place first,
   * then the rule checks and cleans it. `@Expose` makes this run even when only the old name was sent.
   */
  @Expose()
  @Transform(({ obj, value }) => obj.quoteInput ?? value)
  @Rule(cartRequest)
  quote!: QuoteInput;

  @EmailAddress()
  email!: string;

  /** Billing address, e.g. `{ firstName, lastName, address1, city, province, postalCode, country }`. */
  @Rule(address)
  billing!: Record<string, unknown>;

  /** Shipping address, same shape as billing. */
  @Rule(address)
  shipping!: Record<string, unknown>;
}
