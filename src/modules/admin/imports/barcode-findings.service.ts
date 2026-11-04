import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';
import { AdminProductsService } from '../products/admin-products.service.js';

/** A claimed product not reported back within this long can be claimed again (the app was closed, the computer slept). */
const LEASE_MINUTES = 15;
/** At most this many products per claim, and photos per product. */
const BATCH = 20;
const PHOTOS = 8;

export type BarcodeSource = 'photo' | 'page' | 'both';

/** A GTIN's check digit is right (mod 10, weights 3 and 1 from the right). Same rule as Gleamshelf's apps/local/src/barcode.ts. */
export function validGtin(digits: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** A barcode as the shop keeps it: digits only, a UPC-A (12) as its EAN-13; null unless the check digit is right. */
export function cleanBarcode(value: unknown): string | null {
  const digits = (
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  ).replace(/\D/g, '');
  const code = digits.length === 12 ? `0${digits}` : digits;
  return validGtin(code) ? code : null;
}

const SOURCES: BarcodeSource[] = ['photo', 'page', 'both'];

/** Products shoppers can see that have no barcode: neither ours (product details) nor Square's. */
const MISSING = `
  from public.storefront_products p
  left join public.catalog_variations v on v.square_variation_id = p.variation_id
  where coalesce(nullif(btrim(p.jan_code), ''), nullif(btrim(v.upc), '')) is null`;

/**
 * Barcodes for products that have none, found by the connected Gleamshelf app (read off the photos, or given by the product pages it matched to
 * the cover). The app claims products in batches and reports what it found; a person applies (the code becomes the product's JAN code, so the
 * Google Shopping feed has its GTIN) or dismisses each one.
 */
@Injectable()
export class BarcodeFindingsService {
  constructor(
    private readonly db: Db,
    private readonly products: AdminProductsService,
    private readonly log: AdminLog,
  ) {}

  /** The next products to scan: visible, no barcode, not looked at yet (or claimed and never reported). With their photos. */
  async claim() {
    return this.db.transaction(async (tx) => {
      const rows = await this.db.many<{ id: string; name: string; images: string[] }>(
        `select p.id, p.name, p.images ${MISSING}
           and cardinality(p.images) > 0
           and not exists (
             select 1 from public.barcode_findings f where f.square_item_id = p.id
                and not (f.status = 'scanning' and f.claimed_at < now() - make_interval(mins => $1)))
         order by p.rank nulls last, p.created_at desc
         limit $2`,
        [LEASE_MINUTES, BATCH],
        tx,
      );
      if (rows.length)
        await this.db.exec(
          `insert into public.barcode_findings (square_item_id, status, claimed_at) select unnest($1::text[]), 'scanning', now()
           on conflict (square_item_id) do update set status = 'scanning', claimed_at = now()`,
          [rows.map((r) => r.id)],
          tx,
        );
      return rows.map((r) => ({
        productId: r.id,
        productName: r.name,
        photoUrls: r.images.slice(0, PHOTOS),
      }));
    });
  }

  /** What the app found for products it claimed: a code and where it came from, or none. A code with a wrong check digit counts as none. */
  async report(results: { productId: string; code: unknown; source: unknown }[]) {
    let found = 0;
    for (const r of results) {
      const code = cleanBarcode(r.code);
      const source = SOURCES.includes(r.source as BarcodeSource)
        ? (r.source as BarcodeSource)
        : 'photo';
      const row = await this.db.one<{ status: string }>(
        `update public.barcode_findings
            set status = $2, code = $3, source = $4, found_at = case when $3::text is null then found_at else now() end
          where square_item_id = $1 and status in ('scanning', 'none') returning status`,
        [r.productId, code ? 'found' : 'none', code, code ? source : null],
      );
      if (row && code) found++;
    }
    return { found };
  }

  /** A barcode found while describing a product (the pages matched to its cover gave one): kept when the product still has none. */
  async offer(productId: string, value: unknown, source: unknown) {
    const code = cleanBarcode(value);
    if (!code) return;
    const missing = await this.db.one(`select 1 ${MISSING} and p.id = $1`, [productId]);
    if (!missing) return;
    await this.db.exec(
      `insert into public.barcode_findings (square_item_id, status, code, source, found_at) values ($1, 'found', $2, $3, now())
       on conflict (square_item_id) do update set status = 'found', code = excluded.code, source = excluded.source, found_at = now()
        where barcode_findings.status in ('scanning', 'none')`,
      [productId, code, SOURCES.includes(source as BarcodeSource) ? source : 'page'],
    );
  }

  /** For the admin: the barcodes waiting for a person, and how far the scan has got. */
  async list() {
    const found = await this.db.many<{
      id: string;
      name: string;
      image: string | null;
      code: string;
      source: BarcodeSource;
      found_at: string;
    }>(
      `select f.square_item_id as id, p.name, p.images[1] as image, f.code, f.source, f.found_at
         from public.barcode_findings f join public.storefront_products p on p.id = f.square_item_id
        where f.status = 'found'
        order by case f.source when 'both' then 0 when 'photo' then 1 else 2 end, f.found_at`,
    );
    const counts = await this.db.one<{
      missing: number;
      scanned: number;
      none: number;
      applied: number;
    }>(
      `select (select count(*)::int ${MISSING}) as missing,
              (select count(*)::int from public.barcode_findings where status <> 'scanning') as scanned,
              (select count(*)::int from public.barcode_findings where status = 'none') as none,
              (select count(*)::int from public.barcode_findings where status = 'applied') as applied`,
    );
    return {
      found: found.map((f) => ({
        productId: f.id,
        name: f.name,
        image: f.image,
        code: f.code,
        source: f.source,
        foundAt: f.found_at,
      })),
      counts: counts!,
    };
  }

  /** The code becomes the product's JAN code (the website, search and the Google Shopping feed use it). */
  async apply(adminId: string, productId: string) {
    const f = await this.db.one<{ code: string; source: BarcodeSource }>(
      "select code, source from public.barcode_findings where square_item_id = $1 and status = 'found'",
      [productId],
    );
    if (!f) throw notFound('Barcode suggestion');
    const taken = await this.db.one<{ name: string }>(
      `select p.name from public.storefront_products p
         left join public.catalog_variations v on v.square_variation_id = p.variation_id
        where p.id <> $1 and (p.jan_code = $2 or v.upc = $2) limit 1`,
      [productId, f.code],
    );
    if (taken) throw new AppError(`${f.code} is already the barcode of ${taken.name}.`, 409);
    await this.products.updateDetails(adminId, productId, { jan_code: f.code });
    await this.decide(adminId, productId, 'applied');
    await this.log.write(adminId, 'barcode.applied', productId, { code: f.code, source: f.source });
  }

  /** Every waiting code that the photo and the pages agree on, in one go. Codes another product already has are skipped. */
  async applyAgreed(adminId: string) {
    const rows = await this.db.many<{ square_item_id: string }>(
      "select square_item_id from public.barcode_findings where status = 'found' and source = 'both'",
    );
    let applied = 0;
    const skipped: string[] = [];
    for (const r of rows) {
      try {
        await this.apply(adminId, r.square_item_id);
        applied++;
      } catch (e) {
        skipped.push(e instanceof Error ? e.message : String(e));
      }
    }
    return { applied, skipped };
  }

  async dismiss(adminId: string, productId: string) {
    const row = await this.db.one(
      "select 1 from public.barcode_findings where square_item_id = $1 and status = 'found'",
      [productId],
    );
    if (!row) throw notFound('Barcode suggestion');
    await this.decide(adminId, productId, 'dismissed');
    await this.log.write(adminId, 'barcode.dismissed', productId, {});
  }

  private decide(adminId: string, productId: string, status: 'applied' | 'dismissed') {
    return this.db.exec(
      'update public.barcode_findings set status = $3, decided_by = $2, decided_at = now() where square_item_id = $1',
      [productId, adminId, status],
    );
  }
}
