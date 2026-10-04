import { Rule, Text } from '../../../common/validation/decorators.js';
import { stringValue } from '../../../common/validation/rules.js';

export class OrderLookupQuery {
  /** The payment id from the confirmation email. */
  @Text('paymentId', 200)
  paymentId!: string;

  /** The billing email on the order. */
  @Rule((v) => stringValue(v, 'email', 254).toLowerCase())
  email!: string;
}
