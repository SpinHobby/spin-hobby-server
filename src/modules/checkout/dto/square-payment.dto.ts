import { PositiveInt, Rule, Text } from '../../../common/validation/decorators.js';
import { stringValue } from '../../../common/validation/rules.js';

export class SquarePaymentDto {
  /** The order id returned by `POST /checkout/intent`. */
  @PositiveInt('orderId', Number.MAX_SAFE_INTEGER)
  orderId!: number;

  /** The card token (nonce) from Square's Web Payments form. */
  @Text('sourceId', 500)
  sourceId!: string;

  /** The billing email on the order. */
  @Rule((v) => stringValue(v, 'email', 254).toLowerCase())
  email!: string;

  /** Optional 3-D Secure verification token from the Web Payments form; anything that isn't text is ignored. */
  @Rule((v) => (typeof v === 'string' ? v : undefined))
  verificationToken?: string;
}
