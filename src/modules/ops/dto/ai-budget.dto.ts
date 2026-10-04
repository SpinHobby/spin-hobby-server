import { AppError } from '../../../common/errors.js';
import { Rule } from '../../../common/validation/decorators.js';

const dollars = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new AppError('Invalid threshold values');
  return amount;
};

/** Monthly spend limits for an AI tool, in US dollars. */
export class AiBudgetDto {
  /** At or above this, the tool keeps working but the admin shows a warning. */
  @Rule(dollars)
  warnThresholdUsd!: number;

  /** At or above this, the tool is switched off for the rest of the month. */
  @Rule(dollars)
  stopThresholdUsd!: number;
}
