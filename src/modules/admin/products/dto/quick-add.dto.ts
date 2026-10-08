import { AppError } from '../../../../common/errors.js';
import { cleanBarcode } from '../../../../common/barcode.js';
import { Rule } from '../../../../common/validation/decorators.js';
import { CreateManualProductDto } from '../../merch/dto/create-manual-product.dto.js';
import { sanitizeArtworkCrop } from '../../../cashier/identify.service.js';
import type { ArtworkCrop } from '../../../cashier/image-processing.js';

/**
 * A new listing made straight in Square. Takes everything the hand-entered form takes (`janCode` is the barcode),
 * plus whether to keep it off the website and an optional crop of the box artwork for the main photo.
 */
export class QuickAddDto extends CreateManualProductDto {
  /** Keep it off the website for now (it still exists in Square and the Products list). */
  @Rule((v) => v === true)
  hidden = false;

  /** The barcode (UPC / EAN / JAN), digits with a correct check digit; blank for none. */
  @Rule((value) => {
    if (value == null || value === '') return null;
    const clean = cleanBarcode(value);
    if (!clean) throw new AppError('That barcode is not valid (check the digits).');
    return clean;
  })
  barcode: string | null = null;

  /** Box artwork to use as the main photo instead of the first photo as it is. */
  @Rule((value) => (value ? (sanitizeArtworkCrop(value) ?? null) : null))
  artworkCrop: ArtworkCrop | null = null;
}
