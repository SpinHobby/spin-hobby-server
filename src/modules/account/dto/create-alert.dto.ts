import { EmailAddress, Text } from '../../../common/validation/decorators.js';

export class CreateAlertDto {
  @EmailAddress()
  email!: string;

  /** The variation to watch (the `variationId` field in catalog responses). */
  @Text('variationId', 120)
  variationId!: string;
}
