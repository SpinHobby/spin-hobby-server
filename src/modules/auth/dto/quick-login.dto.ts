import { AppError } from '../../../common/errors.js';
import { Rule, Text } from '../../../common/validation/decorators.js';

/** Staging only: one-click sign-in from a remembered device. */
export class QuickLoginDto {
  /** The device key this browser was given after signing in with the staging admin password. */
  @Text('key', 200)
  key!: string;

  @Rule((v) => {
    if (v !== 'owner' && v !== 'staff') throw new AppError('role must be owner or staff.');
    return v;
  })
  role!: 'owner' | 'staff';
}
