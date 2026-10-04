import { AppError } from '../../../../common/errors.js';
import { Rule, Text } from '../../../../common/validation/decorators.js';
import { stringValue } from '../../../../common/validation/rules.js';

/** A photo the admin resized in the browser and sends as base64. */
export class UploadImageDto {
  /** `image/webp`, `image/jpeg` or `image/png`. */
  @Text('contentType', 40)
  contentType!: string;

  /** The image bytes as base64 (a `data:...;base64,` prefix is tolerated). */
  @Rule((value) => {
    const data = stringValue(value, 'data', 8_000_000).replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new AppError('The image data is invalid.');
    return data;
  })
  data!: string;

  /** Where it will be used: `slides` for homepage banners, anything else means `products`. */
  @Rule((v) => (v === 'slides' ? 'slides' : 'products'))
  folder: 'products' | 'slides' = 'products';
}
