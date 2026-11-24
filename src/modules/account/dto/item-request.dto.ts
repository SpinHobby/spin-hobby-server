import { EmailAddress, OptionalText, Text } from '../../../common/validation/decorators.js';

/** "Ask us to find one" for a sold item. */
export class ItemRequestDto {
  @EmailAddress()
  email!: string;

  /** The product (the `id` field in catalog responses). */
  @Text('productId', 120)
  productId!: string;

  /** Anything the shopper wants to add ("boxed only"). */
  @OptionalText(300)
  note: string | null = null;
}
