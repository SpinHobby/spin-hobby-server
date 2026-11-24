import { AppError } from '../../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../../common/validation/decorators.js';
import {
  BACKGROUND_MODES,
  BACKGROUND_RULES,
  type BackgroundMode,
  type BackgroundRule,
} from '../product-background.js';
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

/** A product's own background: `shop`, `white`, `library` (with `backgroundId`) or `box_art`; null or "rule" takes its own choice away. */
const modeChoice = (value: unknown): BackgroundMode | null => {
  if (value === null || value === undefined || value === 'rule') return null;
  if (!BACKGROUND_MODES.includes(value as BackgroundMode))
    throw new AppError('Choose a background for the product.');
  return value as BackgroundMode;
};
const libraryId = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AppError('Choose a background from the library.');
  return value;
};

export class ProductBackgroundDto {
  @Rule(modeChoice)
  mode: BackgroundMode | null = null;

  @Rule(libraryId)
  backgroundId: string | null = null;
}

/** The same choice for many products: the ones in `itemIds`, or every product when it is left out. */
export class ManyBackgroundsDto extends ProductBackgroundDto {
  @Rule((value) => {
    if (value === null || value === undefined) return null;
    if (
      !Array.isArray(value) ||
      value.length > 5000 ||
      value.some((v) => typeof v !== 'string' || !v || v.length > 120)
    )
      throw new AppError('The list of products is invalid.');
    return value as string[];
  })
  itemIds: string[] | null = null;
}

export class BackgroundRuleDto {
  @Rule((value) => {
    if (!BACKGROUND_RULES.includes(value as BackgroundRule))
      throw new AppError('Choose the rule: the shop background, or box art.');
    return value;
  })
  rule!: BackgroundRule;
}

/** A product's box art, sent as base64 like a product photo. */
export class BoxArtDto {
  @Text('contentType', 40)
  contentType!: string;

  @Rule((value) => {
    const data = stringValue(value, 'data', 12_000_000).replace(/^data:[^,]+,/, '');
    if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new AppError('The image data is invalid.');
    return data;
  })
  data!: string;
}
