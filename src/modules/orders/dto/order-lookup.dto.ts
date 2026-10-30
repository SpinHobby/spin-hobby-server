import { EmailAddress, PositiveInt } from '../../../common/validation/decorators.js';

export class OrderLookupQuery {
  /** The order number from the confirmation email (#123). */
  @PositiveInt('order', 2_147_483_647)
  order!: number;

  /** The email the order was placed with. */
  @EmailAddress()
  email!: string;
}
