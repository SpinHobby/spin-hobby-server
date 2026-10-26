import { AppError } from '../../../../common/errors.js';
import { Flag, OptionalText, Provided, Rule } from '../../../../common/validation/decorators.js';
import { playlistId } from '../playlist.js';

const wholeNumber = (field: string) => (value: unknown) => {
  if (!Number.isInteger(Number(value)) || Number(value) < 0)
    throw new AppError(`Invalid ${field}.`);
  return value;
};

/**
 * Any subset of the shop settings (owner only). Fields that aren't sent are left alone. Names match the
 * database columns, so the admin screen can send exactly what it received from GET /admin/settings.
 */
export class UpdateSettingsDto {
  /** `paypal` or `square`: which provider checkout uses. */
  @Provided()
  @Rule((value) => {
    if (value && !['paypal', 'square'].includes(value as string))
      throw new AppError('Invalid payment provider.');
    return value;
  })
  payment_provider?: 'paypal' | 'square';

  /** Shows the maintenance page instead of the storefront. */
  @Provided()
  @Flag('maintenance_mode')
  maintenance_mode?: boolean;

  /** What the maintenance page says (at most 1000 characters; blank clears it). */
  @Provided()
  @OptionalText(1000)
  maintenance_message?: string | null;

  /** The storefront's Shop playlist: a YouTube playlist address or id (blank hides it). Stored as the id. */
  @Provided()
  @Rule(playlistId)
  music_playlist_id?: string | null;

  @Provided()
  @Rule(wholeNumber('shipping_standard_cents'))
  shipping_standard_cents?: number;

  @Provided()
  @Rule(wholeNumber('shipping_express_cents'))
  shipping_express_cents?: number;

  @Provided()
  @Rule(wholeNumber('free_shipping_threshold_cents'))
  free_shipping_threshold_cents?: number;

  /** At or below this many in stock, a product shows as "low stock". */
  @Provided()
  @Rule(wholeNumber('low_stock_threshold'))
  low_stock_threshold?: number;

  @Provided()
  @Rule(wholeNumber('handling_days_min'))
  handling_days_min?: number;

  @Provided()
  @Rule(wholeNumber('handling_days_max'))
  handling_days_max?: number;

  /** CAD to USD rate for the USD display price when the Bank of Canada's live rate can't be reached. Above 0. */
  @Provided()
  @Rule((value) => {
    if (!(Number(value) > 0)) throw new AppError('Invalid fx_cad_usd.');
    return value;
  })
  fx_cad_usd?: number;
}
