import { Text } from '../../../common/validation/decorators.js';

export class AddWishlistDto {
  /** The product's Square item id (the `id` field in catalog responses). */
  @Text('squareItemId', 120)
  squareItemId!: string;
}
