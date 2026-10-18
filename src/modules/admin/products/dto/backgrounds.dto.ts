import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';
import { stringValue } from '../../../../common/validation/rules.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which background to put a photo on: a background's id, null for plain white, or left out for the shop's default. Shared by every place a
 * Gleamshelf photo is used.
 */
export const backgroundChoice = (value: unknown): string | null | undefined => {
  if (value === undefined || value === 'default') return undefined;
  if (value === null || value === '' || value === 'white') return null;
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AppError('Choose a background from the library.');
  return value;
};

/** A new background, sent as base64 like a product photo. */
export class AddBackgroundDto {
  @Text('contentType', 40)
  contentType!: string;

  @Rule((value) => {
    const data = stringValue(value, 'data', 12_000_000).replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new AppError('The image data is invalid.');
    return data;
  })
  data!: string;

  @OptionalText(80)
  name: string | null = null;
}

export class RenameBackgroundDto {
  @Text('name', 80)
  name!: string;
}

/** The shop background; null for plain white. */
export class DefaultBackgroundDto {
  @Rule((v) => backgroundChoice(v ?? null) ?? null)
  id: string | null = null;
}
