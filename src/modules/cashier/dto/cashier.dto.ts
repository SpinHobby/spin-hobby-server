import { IsOptional } from 'class-validator';
import { AppError } from '../../../common/errors.js';
import { Rule } from '../../../common/validation/decorators.js';
import { dollarsToCents } from '../price.js';

// These are multipart form posts (a photo plus text fields), so every field arrives as text.
// Fields marked @IsOptional() are read as sent; the service decides what a blank means.

/** The title is required on both create and edit. */
const requiredTitle = (value: unknown) => {
  if (!value) throw new AppError('title and price are required');
  return value;
};

/** The price is checked here and converted to cents by the service. */
const validPrice = (value: unknown) => {
  dollarsToCents(value);
  return value;
};

/** Photo identification: which condition the cashier selected. */
export class IdentifyDto {
  // A multipart post with no text fields has no body at all; the checks below report what is missing.
  static readonly allowEmptyBody = true;

  /** `sealed` for new-in-box items; anything else is treated as opened/used. */
  @IsOptional()
  condition?: string;
}

/** A new item to put in Square from the cashier tool. */
export class RecordItemDto {
  // A multipart post with no text fields has no body at all; the checks below report what is missing.
  static readonly allowEmptyBody = true;

  @Rule(requiredTitle)
  title!: string;

  /** Price in dollars, above 0. */
  @Rule(validPrice)
  price!: string;

  @IsOptional()
  description?: string;

  /** Anything but the text `false` means hidden from the storefront (the default for convention one-offs). */
  @Rule((v) => v !== 'false')
  hidden = true;

  /** Starting stock; required (0 or more) for items that are not hidden. */
  @IsOptional()
  quantity?: string;

  /** Category name; created in Square if it doesn't exist. */
  @IsOptional()
  category?: string;

  /** `sealed` or `used`; added to the description. */
  @IsOptional()
  condition?: string;

  // Where the artwork sits in the photo, as fractions of its width and height (see sanitizeArtworkCrop).
  @IsOptional()
  artworkCropX?: string;

  @IsOptional()
  artworkCropY?: string;

  @IsOptional()
  artworkCropWidth?: string;

  @IsOptional()
  artworkCropHeight?: string;

  @IsOptional()
  artworkRotationDegrees?: string;
}

/** Changes to an existing Square item from the cashier tool (the whole form is sent). */
export class UpdateItemDto {
  // A multipart post with no text fields has no body at all; the checks below report what is missing.
  static readonly allowEmptyBody = true;

  @Rule(requiredTitle)
  title!: string;

  /** Price in dollars, above 0. */
  @Rule(validPrice)
  price!: string;

  @IsOptional()
  description?: string;

  @Rule((v) => v !== 'false')
  hidden = true;

  @IsOptional()
  quantity?: string;

  /** Category name. Wins over `categoryId` when both are sent. */
  @IsOptional()
  category?: string;

  /** The item's current category id, kept when no category name is sent so editing other fields doesn't clear it. */
  @IsOptional()
  categoryId?: string;

  /** `true` removes the photo (ignored when a new photo is uploaded). */
  @IsOptional()
  removePhoto?: string;
}

/** Searching the Square catalog from the cashier tool. */
export class CashierSearchQuery {
  @IsOptional()
  q?: string;

  /** Where to continue from. */
  @IsOptional()
  cursor?: string;
}
