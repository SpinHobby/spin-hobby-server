import { Flag, OptionalText } from '../../../../common/validation/decorators.js';

/** The shop's answer to everyone waiting for one item. */
export class AnswerRequestDto {
  /** `true`: we have one (or can get one); `false`: it cannot be found. */
  @Flag('found')
  found!: boolean;

  /** A line for the shopper: the price and when, or why not. */
  @OptionalText(600)
  message: string | null = null;

  /** The listing to buy, when it is not the sold one itself (a new listing of the same item). */
  @OptionalText(120)
  buyProductId: string | null = null;
}
