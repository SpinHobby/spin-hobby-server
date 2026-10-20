import { PositiveInt, Rule } from '../../../common/validation/decorators.js';
import { stringValue } from '../../../common/validation/rules.js';

/** A test payment for an order (a local copy of the shop with no payment keys). */
export class TestPaymentDto {
  /** The order id returned by `POST /checkout/intent`. */
  @PositiveInt('orderId', Number.MAX_SAFE_INTEGER)
  orderId!: number;

  /** The billing email on the order. */
  @Rule((v) => stringValue(v, 'email', 254).toLowerCase())
  email!: string;
}
