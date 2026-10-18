import { AppError } from '../../../common/errors.js';
import { OptionalText, Rule, Text } from '../../../common/validation/decorators.js';
import { EBAY_CONDITIONS, type EbayCondition } from '../ebay-listings.service.js';

export class EbaySetupDto {
  @Text('fulfillmentPolicyId', 40)
  fulfillmentPolicyId!: string;

  @Text('paymentPolicyId', 40)
  paymentPolicyId!: string;

  @Text('returnPolicyId', 40)
  returnPolicyId!: string;

  @Text('merchantLocationKey', 36)
  merchantLocationKey!: string;
}

/** Where items ship from (eBay calls it a location). */
export class EbayLocationDto {
  @Text('name', 100)
  name!: string;

  @Text('addressLine1', 128)
  addressLine1!: string;

  @Text('city', 64)
  city!: string;

  @Text('stateOrProvince', 64)
  stateOrProvince!: string;

  @Text('postalCode', 16)
  postalCode!: string;

  @Rule((v) => {
    const c = (typeof v === 'string' ? v : 'CA').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw new AppError('country must be a two-letter code such as CA.');
    return c;
  })
  country = 'CA';
}

export class EbayDisconnectDto {
  /** Disconnect even though listings are still marked live (an owner who has ended them on eBay by hand). */
  @Rule((v) => v === true)
  force = false;
}

export class EbayCategoryQuery {
  @Text('q', 200)
  q!: string;
}

/** A product's eBay listing: what eBay needs beyond the product itself. The quantity is never sent: it is Square's count. */
export class EbayListingDto {
  @Text('title', 200)
  title!: string;

  @OptionalText(4000)
  description: string | null = null;

  @Rule((v) => {
    if (typeof v !== 'string' || !/^\d{1,10}$/.test(v.trim()))
      throw new AppError('Choose an eBay category.');
    return v.trim();
  })
  categoryId!: string;

  @Rule((v) => {
    if (!EBAY_CONDITIONS.includes(v as EbayCondition))
      throw new AppError(`condition must be one of ${EBAY_CONDITIONS.join(', ')}.`);
    return v;
  })
  condition!: EbayCondition;

  @Rule((v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 99 || n > 10_000_000)
      throw new AppError('Enter a price of at least $0.99.');
    return n;
  })
  priceCents!: number;

  /** Item specifics: a name and its values ("Brand": ["SEGA"]). */
  @Rule((v) => {
    if (v == null) return {};
    if (typeof v !== 'object' || Array.isArray(v))
      throw new AppError('aspects must be names with lists of values.');
    const out: Record<string, string[]> = {};
    for (const [name, values] of Object.entries(v as Record<string, unknown>).slice(0, 45)) {
      const list = (Array.isArray(values) ? values : [values])
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .slice(0, 30)
        .map((x) => x.slice(0, 65));
      if (name.trim() && list.length) out[name.trim().slice(0, 40)] = list;
    }
    return out;
  })
  aspects: Record<string, string[]> = {};
}
