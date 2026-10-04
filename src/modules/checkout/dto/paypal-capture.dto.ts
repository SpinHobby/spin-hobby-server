import { Text } from '../../../common/validation/decorators.js';

export class PayPalCaptureDto {
  /** The PayPal order id returned by `POST /checkout/intent`. */
  @Text('paypalOrderId', 200)
  paypalOrderId!: string;
}
