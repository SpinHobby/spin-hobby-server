import { PositiveInt } from '../../../common/validation/decorators.js';

/** The `:id` in /orders/:id. */
export class OrderIdParam {
  @PositiveInt('orderId', Number.MAX_SAFE_INTEGER)
  id!: number;
}
