import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../common/errors.js';
import { ebayCurrency, ebayItemUrl, ebayMarketplaceId } from '../../config/ebay.config.js';
import { Db } from '../../database/db.service.js';
import { EbayClient } from '../../integrations/ebay/ebay.client.js';
import { SquareCatalogClient } from '../../integrations/square/square-catalog.client.js';
import { AdminLog } from '../admin/admin-log.service.js';
import { ChannelPhotosService } from '../admin/products/channel-photos.service.js';
import { SquarePhotosService } from '../admin/products/square-photos.service.js';
import { EbayConnectionService } from './ebay-connection.service.js';

/** eBay's conditions a figure shop uses (eBay's own ids). */
export const EBAY_CONDITIONS = [
  'NEW',
  'NEW_OTHER',
  'LIKE_NEW',
  'USED_EXCELLENT',
  'USED_VERY_GOOD',
  'USED_GOOD',
] as const;
export type EbayCondition = (typeof EBAY_CONDITIONS)[number];

export interface ListingInput {
  title: string;
  description: string | null;
  categoryId: string;
  condition: EbayCondition;
  priceCents: number;
  aspects: Record<string, string[]>;
}

interface ProductRow {
  square_item_id: string;
  name: string;
  description: string | null;
  source: string;
  variation_id: string | null;
  sku: string | null;
  upc: string | null;
  price_cents: number | null;
  series: string | null;
  character: string | null;
  manufacturer: string | null;
  jan_code: string | null;
  quantity: number | null;
}

interface ListingRow {
  square_item_id: string;
  variation_id: string;
  sku: string;
  offer_id: string | null;
  listing_id: string | null;
  status: string;
  title: string;
  category_id: string;
  condition: string;
  aspects: Record<string, string[]>;
  price_cents: number;
  quantity: number;
  pushed_at: string | null;
  last_error: string | null;
  updated_at: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A title eBay accepts: at most 80 characters, cut at a word. */
export function ebayTitle(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= 80) return clean;
  const cut = clean.slice(0, 80);
  return (cut.lastIndexOf(' ') > 50 ? cut.slice(0, cut.lastIndexOf(' ')) : cut).trim();
}

/**
 * Listing a Square product on eBay: the same title, description, photos, price and stock (the stock is never typed: it is Square's count,
 * kept in step by the sync), plus what eBay asks for (a category, the condition and the category's item specifics). A product is one eBay
 * listing, tied to it by its SKU.
 */
@Injectable()
export class EbayListingsService {
  constructor(
    private readonly db: Db,
    private readonly ebay: EbayClient,
    private readonly square: SquareCatalogClient,
    private readonly connection: EbayConnectionService,
    private readonly channels: ChannelPhotosService,
    private readonly photos: SquarePhotosService,
    private readonly log: AdminLog,
  ) {}

  private product(itemId: string) {
    return this.db.one<ProductRow>(
      `select p.square_item_id, p.name, p.description, p.source, p.default_variation_id as variation_id, v.sku, v.upc, v.price_cents,
              m.series, m.character, m.manufacturer, m.jan_code, i.quantity
         from public.catalog_products p
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.product_metadata m on m.square_item_id = p.square_item_id
         left join public.inventory_snapshots i on i.square_variation_id = p.default_variation_id
        where p.square_item_id = $1`,
      [itemId],
    );
  }

  private listing(itemId: string) {
    return this.db.one<ListingRow>('select * from public.ebay_listings where square_item_id = $1', [
      itemId,
    ]);
  }

  /** The photos eBay gets: the ones picked for eBay, else the product's photos in Square. eBay fetches them itself, so only https ones. */
  private async imageUrls(itemId: string): Promise<string[]> {
    const picked = await this.channels.list(itemId, 'ebay');
    const urls = picked.length
      ? picked
      : (await this.photos.list(itemId).catch(() => ({ shown: [] }))).shown.map((p) => p.url);
    return urls.filter((u) => u.startsWith('https://')).slice(0, 12);
  }

  /** What the product drawer shows: the listing (if any), and what a new listing starts from. */
  async forProduct(itemId: string) {
    const p = await this.product(itemId);
    if (!p) throw notFound('Product');
    const l = await this.listing(itemId);
    const status = await this.connection.status();
    const photos = await this.imageUrls(itemId);
    return {
      connected: status.connected,
      ready: status.ready,
      listing: l
        ? {
            status: l.status,
            sku: l.sku,
            listingId: l.listing_id,
            url: l.listing_id ? ebayItemUrl(l.listing_id) : null,
            title: l.title,
            categoryId: l.category_id,
            condition: l.condition,
            aspects: l.aspects,
            priceCents: l.price_cents,
            quantity: l.quantity,
            pushedAt: l.pushed_at,
            error: l.last_error,
            updatedAt: l.updated_at,
          }
        : null,
      draft: {
        title: ebayTitle(p.name),
        description: p.description,
        priceCents: p.price_cents,
        stock: p.quantity,
        photos,
        // item specifics the shop already knows, in eBay's usual names
        aspects: {
          ...(p.manufacturer ? { Brand: [p.manufacturer] } : {}),
          ...(p.series ? { Franchise: [p.series] } : {}),
          ...(p.character ? { Character: [p.character] } : {}),
        },
      },
      canList: p.source === 'square' && !!p.variation_id,
    };
  }

  categories(query: string) {
    if (query.trim().length < 2) throw new AppError('Type at least two letters.');
    return this.ebay.categorySuggestions(query.trim());
  }

  aspects(categoryId: string) {
    return this.ebay.categoryAspects(categoryId);
  }

  /**
   * Lists the product on eBay, or revises its listing. The inventory item (title, description, photos, specifics, condition, Square's count)
   * and the offer (category, price, the seller's policies and location) are written, then the offer is published. A listing that exists is
   * revised in place (eBay keeps the same listing).
   */
  async save(adminId: string, itemId: string, input: ListingInput) {
    const c = await this.connection.requireReady();
    const p = await this.product(itemId);
    if (!p) throw notFound('Product');
    if (p.source !== 'square' || !p.variation_id)
      throw new AppError(
        'Only products kept in Square can go on eBay (their stock is what stays in step).',
      );
    const title = ebayTitle(input.title);
    if (!title) throw new AppError('Give the listing a title.');
    const images = await this.imageUrls(itemId);
    if (!images.length)
      throw new AppError(
        'eBay needs at least one photo it can fetch (a photo in Square, or one picked for eBay).',
      );
    // the quantity is always Square's count, read now
    const quantity = Math.max(
      0,
      Math.floor((await this.square.getInventoryCounts([p.variation_id]))[p.variation_id] ?? 0),
    );
    const existing = await this.listing(itemId);
    if (!existing && quantity < 1)
      throw new AppError(
        'This product has none in stock in Square, so there is nothing to list yet.',
      );
    const sku = existing?.sku ?? (await this.newSku(p));
    const description = (input.description ?? p.description ?? title).trim();
    const gtin = (p.jan_code ?? p.upc ?? '').replace(/\D/g, '');

    try {
      await this.ebay.putInventoryItem(sku, {
        availability: { shipToLocationAvailability: { quantity } },
        condition: input.condition,
        product: {
          title,
          description,
          aspects: input.aspects,
          imageUrls: images,
          ...(gtin.length === 13 ? { ean: [gtin] } : gtin.length === 12 ? { upc: [gtin] } : {}),
        },
      });
      const offer = {
        sku,
        marketplaceId: ebayMarketplaceId(),
        format: 'FIXED_PRICE',
        availableQuantity: quantity,
        categoryId: input.categoryId,
        listingDescription: description
          .split(/\n{2,}/)
          .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
          .join(''),
        listingPolicies: {
          fulfillmentPolicyId: c.fulfillment_policy_id,
          paymentPolicyId: c.payment_policy_id,
          returnPolicyId: c.return_policy_id,
        },
        merchantLocationKey: c.merchant_location_key,
        pricingSummary: {
          price: { value: (input.priceCents / 100).toFixed(2), currency: ebayCurrency() },
        },
      };
      const known = existing?.offer_id ?? (await this.ebay.offersFor(sku))[0]?.offerId ?? null;
      let offerId = known;
      if (offerId) await this.ebay.updateOffer(offerId, offer);
      else offerId = await this.ebay.createOffer(offer);
      // a live listing is revised by the offer update; otherwise the offer is published now
      const live =
        existing?.listing_id &&
        (existing.status === 'active' || existing.status === 'out_of_stock');
      const listingId = live ? existing.listing_id! : await this.ebay.publishOffer(offerId);
      await this.db.exec(
        `insert into public.ebay_listings (square_item_id, variation_id, sku, offer_id, listing_id, status, title, category_id, condition, aspects, price_cents, quantity, pushed_at, last_error, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), null, $13)
         on conflict (square_item_id) do update set variation_id = excluded.variation_id, offer_id = excluded.offer_id, listing_id = excluded.listing_id,
           status = excluded.status, title = excluded.title, category_id = excluded.category_id, condition = excluded.condition, aspects = excluded.aspects,
           price_cents = excluded.price_cents, quantity = excluded.quantity, pushed_at = now(), last_error = null`,
        [
          itemId,
          p.variation_id,
          sku,
          offerId,
          listingId,
          quantity > 0 ? 'active' : 'out_of_stock',
          title,
          input.categoryId,
          input.condition,
          JSON.stringify(input.aspects),
          input.priceCents,
          quantity,
          adminId,
        ],
      );
      await this.log.write(adminId, existing ? 'ebay.listing_revised' : 'ebay.listed', itemId, {
        sku,
        listingId,
        quantity,
        priceCents: input.priceCents,
      });
      return this.forProduct(itemId);
    } catch (error) {
      if (existing)
        await this.db.exec(
          'update public.ebay_listings set last_error = $2 where square_item_id = $1',
          [itemId, (error instanceof Error ? error.message : String(error)).slice(0, 500)],
        );
      throw error;
    }
  }

  /** Ends the eBay listing (the offer is withdrawn: eBay stops selling it). Its sales already applied stay applied. */
  async end(adminId: string, itemId: string) {
    await this.connection.requireConnected();
    const l = await this.listing(itemId);
    if (!l) throw new AppError('This product is not on eBay.', 404);
    if (l.offer_id && (l.status === 'active' || l.status === 'out_of_stock'))
      await this.ebay.withdrawOffer(l.offer_id);
    await this.db.exec(
      "update public.ebay_listings set status = 'ended', last_error = null where square_item_id = $1",
      [itemId],
    );
    await this.log.write(adminId, 'ebay.listing_ended', itemId, {
      sku: l.sku,
      listingId: l.listing_id,
    });
    return this.forProduct(itemId);
  }

  /** The product's SKU on eBay: its Square SKU when it has one nobody else uses on eBay, else one made from its Square id. */
  private async newSku(p: ProductRow): Promise<string> {
    const candidates = [p.sku?.trim(), `SH-${p.square_item_id}`.slice(0, 50)].filter(
      (s): s is string => !!s && s.length <= 50,
    );
    for (const sku of candidates) {
      const taken = await this.db.one(
        'select 1 from public.ebay_listings where sku = $1 and square_item_id <> $2',
        [sku, p.square_item_id],
      );
      if (!taken) return sku;
    }
    throw new AppError('Could not find a free SKU for this product on eBay.');
  }
}
