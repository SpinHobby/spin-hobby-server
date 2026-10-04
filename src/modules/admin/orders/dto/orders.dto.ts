import { IsOptional } from 'class-validator';
import { OptionalText, Text } from '../../../../common/validation/decorators.js';

/** `GET /admin/orders` filters. Checked by AdminOrdersService (an unknown status is a 400). */
export class AdminOrdersQuery {
  /** `all` (default) or one of: `pending`, `paid`, `preorder_reserved`, `fulfilled`, `shipped`, `cancelled`, `refunded`. */
  @IsOptional()
  status?: string;

  /** How many orders to return, 1 to 100 (default 50). */
  @IsOptional()
  limit?: string;
}

/** Marking a paid order as shipped. */
export class ShipOrderDto {
  /** The carrier's tracking number; it is emailed to the customer. */
  @Text('trackingNumber', 200)
  trackingNumber!: string;

  /** e.g. `Canada Post`. */
  @OptionalText(100)
  carrier: string | null = null;
}

/** Refunding an order. */
export class RefundOrderDto {
  /** A refund may be requested with no body at all, which means "refund everything". */
  static readonly allowEmptyBody = true;

  /**
   * How much to refund, in cents (1 up to the order total). Leave out to refund the whole order.
   * The upper limit depends on the order, so AdminOrdersService checks it.
   */
  @IsOptional()
  amountCents?: number;
}
