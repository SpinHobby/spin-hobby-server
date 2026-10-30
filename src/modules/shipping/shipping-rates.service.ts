import { Injectable, Logger } from '@nestjs/common';
import { Db, type Queryable } from '../../database/db.service.js';
import type { StoreSettingsRow } from '../../database/rows.js';
import { EasyPostClient } from '../../integrations/easypost/easypost.client.js';
import {
  parcelFor,
  shippingOptions,
  type ParcelSize,
  type Rate,
  type ShippingOption,
} from './shipping-math.js';

/** A rate is reused this long (a quote and the payment after it see the same prices, and EasyPost isn't asked on every keystroke). */
const CACHE_MINUTES = 20;
/** After a failure, the flat prices are used for this long before EasyPost is asked again for the same parcel. */
const FAILURE_MINUTES = 2;
const CACHE_MAX = 500;

type Size = Partial<
  Record<
    'parcel_weight_g' | 'parcel_length_cm' | 'parcel_width_cm' | 'parcel_height_cm',
    number | null
  >
>;
const FIELDS = [
  'parcel_weight_g',
  'parcel_length_cm',
  'parcel_width_cm',
  'parcel_height_cm',
] as const;

export interface ShippingRequest {
  country: 'CA' | 'US';
  province: string;
  /** Normalized ("T2P 1J9", "98101"); without one, only the flat prices can be given. */
  postalCode: string | null;
  city?: string | null;
  items: { variationId: string; quantity: number }[];
}

export interface ShippingQuote {
  /** True when the options are couriers' live rates; false for the shop's flat standard/express prices. */
  live: boolean;
  options: ShippingOption[];
}

/**
 * The courier options for a cart: live rates from EasyPost for the parcel the cart makes (sizes from the product, else its nearest category
 * that has one, else the shop's default), or the shop's flat standard and express prices when live rates can't be had (no key, no ship-from
 * postal code, no postal code yet, or EasyPost failed). The free-shipping rule is applied either way (shipping-math.ts).
 */
@Injectable()
export class ShippingRatesService {
  private readonly logger = new Logger(ShippingRatesService.name);
  private readonly cache = new Map<string, { at: number; rates: Rate[] | null }>();

  constructor(
    private readonly db: Db,
    private readonly easypost: EasyPostClient,
  ) {}

  /** Whether live rates are possible at all (the key and the ship-from postal code are set). */
  liveReady(settings: Pick<StoreSettingsRow, 'ship_from_postal'>) {
    return this.easypost.configured && !!settings.ship_from_postal;
  }

  async options(
    req: ShippingRequest,
    settings: StoreSettingsRow,
    goodsCents: number,
    tx?: Queryable,
  ): Promise<ShippingQuote> {
    const threshold = Number(settings.free_shipping_threshold_cents);
    const live =
      req.postalCode && this.liveReady(settings) ? await this.liveRates(req, settings, tx) : null;
    if (live?.length) return { live: true, options: shippingOptions(live, goodsCents, threshold) };
    const flat: Rate[] = [
      {
        carrier: 'Spin Hobby',
        service: 'Standard',
        cents: Number(settings.shipping_standard_cents),
        days: null,
      },
      {
        carrier: 'Spin Hobby',
        service: 'Express',
        cents: Number(settings.shipping_express_cents),
        days: null,
      },
    ];
    return { live: false, options: shippingOptions(flat, goodsCents, threshold) };
  }

  /** The parcel this cart makes. */
  async parcel(
    items: ShippingRequest['items'],
    settings: StoreSettingsRow,
    tx?: Queryable,
  ): Promise<ParcelSize> {
    const rows = await this.db.many<
      Size & { square_variation_id: string; category_id: string | null }
    >(
      `select v.square_variation_id, m.category_id, ${FIELDS.map((f) => `m.${f}`).join(', ')}
         from public.catalog_variations v left join public.product_metadata m on m.square_item_id = v.square_item_id
        where v.square_variation_id = any($1::text[])`,
      [items.map((i) => i.variationId)],
      tx,
    );
    const categories = new Map(
      (
        await this.db.many<Size & { id: string; parent_id: string | null }>(
          `select id, parent_id, ${FIELDS.join(', ')} from public.store_categories`,
          [],
          tx,
        )
      ).map((c) => [c.id, c]),
    );
    const byId = new Map(rows.map((r) => [r.square_variation_id, r]));
    const sizeOf = (variationId: string): ParcelSize => {
      const row = byId.get(variationId);
      const pick = (f: (typeof FIELDS)[number]) => {
        if (row?.[f]) return Number(row[f]);
        // the nearest category up the tree that says (a "Nendoroids" size beats "Figures")
        for (
          let c = row?.category_id ? categories.get(row.category_id) : undefined, n = 0;
          c && n < 10;
          n++
        )
          if (c[f]) return Number(c[f]);
          else c = c.parent_id ? categories.get(c.parent_id) : undefined;
        return Number(settings[f]);
      };
      return {
        weightG: pick('parcel_weight_g'),
        lengthCm: pick('parcel_length_cm'),
        widthCm: pick('parcel_width_cm'),
        heightCm: pick('parcel_height_cm'),
      };
    };
    return parcelFor(
      items.map((i) => ({ size: sizeOf(i.variationId), quantity: i.quantity })),
      Number(settings.packaging_weight_g),
    );
  }

  private async liveRates(
    req: ShippingRequest,
    settings: StoreSettingsRow,
    tx?: Queryable,
  ): Promise<Rate[] | null> {
    const parcel = await this.parcel(req.items, settings, tx);
    const from = {
      country: 'CA' as const,
      postalCode: settings.ship_from_postal!,
      province: settings.ship_from_province ?? '',
      city: settings.ship_from_city,
    };
    const to = {
      country: req.country,
      postalCode: req.postalCode!,
      province: req.province,
      city: req.city ?? null,
    };
    const key = JSON.stringify([from, { ...to, city: null }, parcel]);
    const hit = this.cache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < (hit.rates ? CACHE_MINUTES : FAILURE_MINUTES) * 60_000) return hit.rates;
    const rates = await this.easypost.rates(from, to, parcel).catch((e: Error) => {
      this.logger.warn(`Live shipping rates failed, using the flat prices: ${e.message}`);
      return null;
    });
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { at: Date.now(), rates });
    return rates;
  }
}
