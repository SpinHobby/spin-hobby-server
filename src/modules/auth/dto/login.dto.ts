import { Rule, Text } from '../../../common/validation/decorators.js';
import { stringValue } from '../../../common/validation/rules.js';

export class LoginDto {
  /** Email address. On staging the admin username is accepted here too. */
  @Rule((v) => stringValue(v, 'email', 254).toLowerCase())
  email!: string;

  @Text('password', 200)
  password!: string;
}
