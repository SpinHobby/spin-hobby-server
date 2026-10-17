import { AppError } from '../../../../common/errors.js';
import { Rule } from '../../../../common/validation/decorators.js';

/** The photos for a sales channel, in order (addresses of the product's photos). */
export class ChannelPhotosDto {
  @Rule((value) => {
    if (
      !Array.isArray(value) ||
      value.length > 12 ||
      value.some((u) => typeof u !== 'string' || !/^https?:\/\//.test(u) || u.length > 1000)
    )
      throw new AppError('Send up to 12 photo addresses.');
    return value as string[];
  })
  urls!: string[];
}
