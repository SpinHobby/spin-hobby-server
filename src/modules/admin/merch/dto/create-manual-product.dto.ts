import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';
import { positiveInteger } from '../../../../common/validation/rules.js';
import { categoryId } from '../../categories/category-id.js';
import { dateOrMonth, imageUrls, priceCents, stock } from './merch-rules.js';

/** A product the shop sells that isn't in Square (convention exclusives, one-offs). */
export class CreateManualProductDto {
  @Text('name', 200)
  name!: string;

  /** Price in cents, above 0. */
  @Rule(priceCents)
  priceCents!: number;

  /** Units in stock; null or blank means not tracked (unlimited). */
  @Rule(stock)
  stockCount: number | null = null;

  /** Up to 8 photo URLs. */
  @Rule((value) => imageUrls(value ?? []))
  imageUrls: string[] = [];

  /** `preorder` needs `orderByDate`; anything else means `auto` (sold from stock). */
  @Rule((v) => (v === 'preorder' ? 'preorder' : 'auto'))
  availability: 'auto' | 'preorder' = 'auto';

  @Rule((v) => dateOrMonth(v, 'order-by date'))
  orderByDate: string | null = null;

  /** `YYYY-MM`; stored as the first of that month. */
  @Rule((v) => dateOrMonth(v, 'release month'))
  releaseMonth: string | null = null;

  /** A shop category id, or null for none. */
  @Rule(categoryId)
  categoryId: string | null = null;

  @OptionalText(2000)
  description: string | null = null;

  /** Free-text category label (separate from the shop category). */
  @OptionalText(120)
  category: string | null = null;

  @OptionalText(120)
  series: string | null = null;

  @OptionalText(20)
  janCode: string | null = null;

  /** The "was" price in cents, shown struck through. */
  @Rule((v) => (v ? priceCents(v) : null))
  compareAtCents: number | null = null;

  @Rule((v) => (v ? positiveInteger(v, 'maxPerCustomer', 1000) : null))
  maxPerCustomer: number | null = null;

  @Rule((v) => v === true)
  isFeatured = false;
}
