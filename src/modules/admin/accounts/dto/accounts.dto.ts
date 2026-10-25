import { IsOptional } from 'class-validator';
import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';
import { optionalString } from '../../../../common/validation/rules.js';
import { isRole, ROLES, type AppRole } from '../../../auth/roles.js';

const STATUSES = ['active', 'suspended', 'banned'] as const;
export type AccountStatus = (typeof STATUSES)[number];

/** Which accounts to list. */
export class AccountsQuery {
  /** Part of an email address or name. */
  @IsOptional()
  q?: string;

  /** One role, e.g. `staff`. */
  @IsOptional()
  @Rule((v) => {
    if (isRole(v)) return v;
    throw new AppError(`role must be one of ${ROLES.map((r) => r.key).join(', ')}.`);
  })
  role?: AppRole;

  /** `active`, `suspended` or `banned`. */
  @IsOptional()
  @Rule((v) => {
    if (STATUSES.includes(v as AccountStatus)) return v;
    throw new AppError(`status must be one of ${STATUSES.join(', ')}.`);
  })
  status?: AccountStatus;

  /** Page size, 1 to 100 (default 50). */
  @IsOptional()
  @Rule((v) => Math.min(100, Math.max(1, Math.trunc(Number(v)) || 50)))
  limit = 50;

  /** How many to skip (default 0). */
  @IsOptional()
  @Rule((v) => Math.max(0, Math.trunc(Number(v)) || 0))
  offset = 0;
}

/** A new role for an account. */
export class RoleDto {
  @Rule((v) => {
    if (isRole(v)) return v;
    throw new AppError(`role must be one of ${ROLES.map((r) => r.key).join(', ')}.`);
  })
  role!: AppRole;
}

/** Suspend an account until a day, ban it for good, or lift either. */
export class RestrictionDto {
  /** `suspend`, `ban` or `lift`. */
  @Rule((v) => {
    if (v === 'suspend' || v === 'ban' || v === 'lift') return v;
    throw new AppError('action must be suspend, ban or lift.');
  })
  action!: 'suspend' | 'ban' | 'lift';

  /** For `suspend`: the last day of the suspension, e.g. `2027-01-31` (it ends at the end of that day, Toronto time). */
  @IsOptional()
  @Rule((v) => {
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))
      return v;
    throw new AppError('until must be a date like 2027-01-31.');
  })
  until?: string;

  /** Why (shown to the person when they try to sign in, and kept in the log). */
  @IsOptional()
  @Rule((v) => optionalString(v, 300))
  reason?: string | null;
}
