import { AppError } from '../../../../common/errors.js';
import { Flag, OptionalText, Provided, Rule } from '../../../../common/validation/decorators.js';
import { playlistId } from '../playlist.js';

const positiveWhole = (field: string) => (value: unknown) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new AppError(`Invalid ${field}.`);
  return n;
};

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

  /** Where parcels leave from: a Canadian postal code (live courier rates need it; blank turns them off). */
  @Provided()
  @Rule((value) => {
    if (value === null || value === '') return null;
    const raw = typeof value === 'string' ? value.toUpperCase().replace(/\s+/g, '') : '';
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(raw))
      throw new AppError('Enter a Canadian postal code, like T2P 1J9.');
    return `${raw.slice(0, 3)} ${raw.slice(3)}`;
  })
  ship_from_postal?: string | null;

  @Provided()
  @OptionalText(80)
  ship_from_city?: string | null;

  /** Province code, e.g. AB. */
  @Provided()
  @Rule((value) => {
    if (value === null || value === '') return null;
    const code = typeof value === 'string' ? value.toUpperCase().trim() : '';
    if (!/^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test(code))
      throw new AppError('Enter a province code, like AB.');
    return code;
  })
  ship_from_province?: string | null;

  /** The default packed size of one item, when neither the product nor its category gives one (grams and cm, above 0). */
  @Provided()
  @Rule(positiveWhole('parcel_weight_g'))
  parcel_weight_g?: number;

  @Provided()
  @Rule(positiveWhole('parcel_length_cm'))
  parcel_length_cm?: number;

  @Provided()
  @Rule(positiveWhole('parcel_width_cm'))
  parcel_width_cm?: number;

  @Provided()
  @Rule(positiveWhole('parcel_height_cm'))
  parcel_height_cm?: number;

  /** What the box and padding add to every order (grams). */
  @Provided()
  @Rule(wholeNumber('packaging_weight_g'))
  packaging_weight_g?: number;

  /** CAD to USD rate for the USD display price when the Bank of Canada's live rate can't be reached. Above 0. */
  @Provided()
  @Rule((value) => {
    if (!(Number(value) > 0)) throw new AppError('Invalid fx_cad_usd.');
    return value;
  })
  fx_cad_usd?: number;
}
