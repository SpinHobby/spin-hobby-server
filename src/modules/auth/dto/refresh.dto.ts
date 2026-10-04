import { Text } from '../../../common/validation/decorators.js';

export class RefreshDto {
  @Text('refreshToken', 2000)
  refreshToken!: string;
}
