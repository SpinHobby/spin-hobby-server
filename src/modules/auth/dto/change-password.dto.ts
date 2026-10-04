import { NewPassword } from './new-password.js';

export class ChangePasswordDto {
  /** The new password, at least 8 characters. */
  @NewPassword()
  password!: string;
}
