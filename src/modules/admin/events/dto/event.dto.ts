import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';
import { optionalString } from '../../../../common/validation/rules.js';
import { SortOrder } from '../../dto/sort-order.js';

/** A date as `YYYY-MM-DD`, or null when blank. */
const isoDate = (value: unknown) => {
  const date = optionalString(value, 30);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Dates must be YYYY-MM-DD.');
  return date;
};

/** A convention or pop-up shown in the storefront's "Meet us at the con" strip. Used for create and for replace. */
export class EventDto {
  @Text('name', 160)
  name!: string;

  @OptionalText(120)
  city: string | null = null;

  @Rule(isoDate)
  startDate: string | null = null;

  /** Must not be before `startDate`. */
  @Rule(isoDate)
  endDate: string | null = null;

  @OptionalText(200)
  boothInfo: string | null = null;

  /** Visible unless explicitly `false`. */
  @Rule((v) => v !== false)
  isVisible = true;

  @SortOrder()
  sortOrder = 0;
}
