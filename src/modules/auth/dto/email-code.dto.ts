import { AppError } from '../../../common/errors.js';
import { Rule } from '../../../common/validation/decorators.js';

export class EmailCodeDto {
  /** The 6 digits from the email; spaces and dashes typed between them are ignored. */
  @Rule((v) => {
    const code = typeof v === 'string' ? v.replace(/[\s-]/g, '') : '';
    if (!/^\d{6}$/.test(code)) throw new AppError('Enter the 6-digit code from the email.');
    return code;
  })
  code!: string;
}
