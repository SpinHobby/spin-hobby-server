import { Flag } from '../../../../common/validation/decorators.js';

/** Showing or hiding a product on the website. */
export class SetVisibleDto {
  /** `true` shows the product on the website; `false` hides it (it stays in the database). */
  @Flag('visible')
  visible!: boolean;
}
