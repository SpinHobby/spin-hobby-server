import { Injectable, Logger } from '@nestjs/common';
import { easypostApiKey } from '../../config/shipping.config.js';
import type { ParcelSize, Rate } from '../../modules/shipping/shipping-math.js';

/** Where a parcel goes or leaves from: enough for a rate (a postal code and the province or state; the city when known). */
export interface RateAddress {
  country: 'CA' | 'US';
  postalCode: string;
  province: string;
  city?: string | null;
}

/** EasyPost's carrier names as shoppers know them. */
const CARRIERS: Record<string, string> = {
  CanadaPost: 'Canada Post',
  UPS: 'UPS',
  UPSDAP: 'UPS',
  Purolator: 'Purolator',
  FedEx: 'FedEx',
  FedExDefault: 'FedEx',
  Canpar: 'Canpar',
  DHLExpress: 'DHL Express',
  USPS: 'USPS',
  Loomis: 'Loomis',
};

/** "ExpeditedParcel" → "Expedited Parcel", "UPSStandard" → "Standard" (the carrier is shown beside it). */
export function serviceLabel(carrier: string, service: string) {
  const plain = service
    .replace(new RegExp(`^${carrier}`, 'i'), '')
    .replace(/^UPS|^FedEx|^Purolator/i, '');
  return (plain || service)
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

const OZ_PER_G = 0.035274;
const IN_PER_CM = 0.393701;
const round1 = (n: number) => Math.max(0.1, Math.round(n * 10) / 10);

/**
 * Courier rates through EasyPost (one API for Canada Post, UPS, Purolator, FedEx and the rest set up on the account). Rates only: asking for
 * them makes a shipment record but buys nothing. Off without EASYPOST_API_KEY.
 */
@Injectable()
export class EasyPostClient {
  private readonly logger = new Logger(EasyPostClient.name);

  get configured() {
    return !!easypostApiKey();
  }

  /** Every rate the account's couriers give for this parcel, in cents (CAD rates only). Throws when EasyPost can't be reached or refuses. */
  async rates(from: RateAddress, to: RateAddress, parcel: ParcelSize): Promise<Rate[]> {
    const key = easypostApiKey();
    if (!key) throw new Error('EasyPost is not set up (EASYPOST_API_KEY).');
    const address = (a: RateAddress) => ({
      zip: a.postalCode,
      state: a.province,
      country: a.country,
      ...(a.city ? { city: a.city } : {}),
    });
    const res = await fetch('https://api.easypost.com/v2/shipments', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        shipment: {
          from_address: address(from),
          to_address: address(to),
          parcel: {
            weight: round1(parcel.weightG * OZ_PER_G),
            length: round1(parcel.lengthCm * IN_PER_CM),
            width: round1(parcel.widthCm * IN_PER_CM),
            height: round1(parcel.heightCm * IN_PER_CM),
          },
        },
      }),
      signal: AbortSignal.timeout(8_000), // a slow courier must not hold up checkout: the flat prices are used instead
    });
    if (!res.ok) {
      this.logger.warn(`EasyPost refused a rate request: ${res.status}`);
      throw new Error(`EasyPost answered ${res.status}.`);
    }
    const body = (await res.json()) as {
      rates?: {
        carrier?: string;
        service?: string;
        rate?: string;
        currency?: string;
        delivery_days?: number | null;
        est_delivery_days?: number | null;
      }[];
    };
    return (body.rates ?? [])
      .filter((r) => r.carrier && r.service && r.rate && (r.currency ?? 'CAD') === 'CAD')
      .map((r) => ({
        carrier: CARRIERS[r.carrier!] ?? r.carrier!,
        service: serviceLabel(r.carrier!, r.service!),
        cents: Math.round(Number(r.rate) * 100),
        days: r.delivery_days ?? r.est_delivery_days ?? null,
      }))
      .filter((r) => Number.isFinite(r.cents));
  }
}
