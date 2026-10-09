import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';
import { stringValue } from '../../../../common/validation/rules.js';

export class PhotoOrderDto {
  /** The ids of the photos to show, in order (the first is the main photo). Photos left out are hidden, not deleted. */
  @Rule((value) => {
    if (
      !Array.isArray(value) ||
      value.length > 20 ||
      value.some((id) => typeof id !== 'string' || !id) ||
      new Set(value).size !== value.length
    )
      throw new AppError('Send up to 20 different photo ids.');
    return value;
  })
  ids!: string[];
}

/** A new photo (usually an edited version of an existing one), sent as base64. It never replaces anything. */
export class AddPhotoDto {
  @Text('contentType', 40)
  contentType!: string;

  @Rule((value) => {
    const data = stringValue(value, 'data', 12_000_000).replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new AppError('The image data is invalid.');
    return data;
  })
  data!: string;

  /** The photo this one is an edit of: the new photo takes its place and the original is hidden (kept). */
  @OptionalText(80)
  replaces: string | null = null;
}
