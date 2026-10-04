import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';
import { stringValue } from '../../../../common/validation/rules.js';

const INVALID = 'Invalid tax rate.';

export class TaxRateDto {
  /** Province or state code, e.g. `AB`. */
  @Rule((v) => stringValue(v, 'province', 10).toUpperCase())
  province!: string;

  /** `CA` or `US`. */
  @Rule((v) => {
    if (v === 'CA' || v === 'US') return v;
    throw new AppError(INVALID);
  })
  country!: 'CA' | 'US';

  /** A fraction from 0 to 1, e.g. `0.05` for 5%. */
  @Rule((v) => {
    const rate = Number(v);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new AppError(INVALID);
    return rate;
  })
  rate!: number;

  /** Whether the rate is applied at checkout. Defaults to true. */
  @Rule((v) => v !== false)
  enabled = true;
}
