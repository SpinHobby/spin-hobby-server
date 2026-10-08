import { positiveInteger } from '../../../../common/validation/rules.js';
import { Rule } from '../../../../common/validation/decorators.js';

export class AddStockDto {
  /** How many units to add (1 to 10,000). */
  @Rule((v) => positiveInteger(v, 'quantity', 10_000))
  quantity!: number;
}
