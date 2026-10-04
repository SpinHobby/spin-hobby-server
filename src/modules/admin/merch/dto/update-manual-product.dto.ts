import { OptionalText, Provided, Rule, Text } from '../../../../common/validation/decorators.js';
import { imageUrls, priceCents, stock } from './merch-rules.js';

/** Changes to a hand-entered product: any subset. Fields that aren't sent are left alone. */
export class UpdateManualProductDto {
  @Provided()
  @Text('name', 200)
  name?: string;

  @Provided()
  @OptionalText(120)
  category?: string | null;

  @Provided()
  @OptionalText(2000)
  description?: string | null;

  /** Price in cents, above 0. */
  @Provided()
  @Rule(priceCents)
  priceCents?: number;

  /** Units in stock; null or blank means not tracked (unlimited). */
  @Provided()
  @Rule(stock)
  stockCount?: number | null;

  /** Replaces all photos (up to 8 URLs). */
  @Provided()
  @Rule(imageUrls)
  imageUrls?: string[];
}
