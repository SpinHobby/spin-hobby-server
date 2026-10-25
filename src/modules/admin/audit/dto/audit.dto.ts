import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';
import { boolValue } from '../../../../common/validation/rules.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (field: string) => (value: unknown) => {
  if (typeof value === 'string' && DAY.test(value) && !Number.isNaN(Date.parse(value)))
    return value;
  throw new AppError(`${field} must be a date like 2026-10-01.`);
};

/** A period of sales, both days included, in the shop's time zone (Toronto). */
export class SalesQuery {
  /** First day, e.g. `2026-10-01`. */
  @Rule(day('from'))
  from!: string;

  /** Last day, e.g. `2026-10-31`. */
  @Rule(day('to'))
  to!: string;
}

/** Whether a staff account may open Audit. */
export class AuditAccessDto {
  @Rule((v) => boolValue(v, 'canAudit'))
  canAudit!: boolean;
}
