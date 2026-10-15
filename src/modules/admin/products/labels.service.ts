import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { SquareCatalogClient } from '../../../integrations/square/square-catalog.client.js';
import { AdminLog } from '../admin-log.service.js';

// Shelf stickers: each product's label carries a code the cashier can type or scan in Square's POS to find that exact
// listing. Square's POS finds items by name, SKU or barcode (never by Square's internal id), so the code is the
// product's SKU. A product without one is given a short shop SKU ("SH-" and six characters), saved in Square first
// and then here, so the next sync brings back the same value.

/** Letters and digits that can't be mistaken for each other on a small sticker (no 0/O, 1/I/L). */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const shopSku = () =>
  `SH-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

interface LabelRow {
  id: string;
  name: string;
  series: string | null;
  source: 'square' | 'manual';
  is_active: boolean;
  variation_id: string | null;
  sku: string | null;
  upc: string | null;
  stock: number | null;
}

export interface Label {
  id: string;
  name: string;
  series: string | null;
  /** What the cashier types or scans; null only for a product with no variation. */
  code: string | null;
  /** The barcode number Square holds (UPC / EAN / JAN); its POS finds the item by it too. */
  upc: string | null;
  /** Whether the cashier can ring it up in Square (a hand-entered product lives only on the website). */
  inSquare: boolean;
  /** Units in stock (null when Square doesn't track it), for one sticker per unit. */
  stock: number | null;
}

@Injectable()
export class LabelsService {
  constructor(
    private readonly db: Db,
    private readonly square: SquareCatalogClient,
    private readonly log: AdminLog,
  ) {}

  /** The label details for these products, in the order given, giving a SKU to any product without one. */
  async prepare(adminId: string, ids: string[]): Promise<{ labels: Label[]; assigned: number }> {
    const rows = await this.db.many<LabelRow>(
      `select p.square_item_id as id, p.name, m.series, p.source, p.is_active, p.default_variation_id as variation_id, nullif(btrim(v.sku), '') as sku, nullif(btrim(v.upc), '') as upc, i.quantity as stock
         from public.catalog_products p
         left join public.catalog_variations v on v.square_variation_id = p.default_variation_id
         left join public.product_metadata m on m.square_item_id = p.square_item_id
         left join public.inventory_snapshots i on i.square_variation_id = p.default_variation_id
        where p.square_item_id = any($1::text[]) and p.replaced_by is null`,
      [ids],
    );
    if (!rows.length) throw new AppError('None of these products were found.', 404);

    // A product deleted in Square (retired) is left alone: there is nothing for the cashier to find.
    const missing = rows.filter(
      (r) => !r.sku && r.variation_id && (r.source === 'manual' || r.is_active),
    );
    const fresh = await this.uniqueSkus(missing.length);
    const wanted = new Map(missing.map((r, i) => [r.variation_id as string, fresh[i]]));

    // Square first: a SKU only counts once the POS can find it.
    const inSquare = missing.filter((r) => r.source === 'square');
    if (inSquare.length) {
      let saved: string[];
      try {
        saved = await this.square.setVariationSkus(
          Object.fromEntries(inSquare.map((r) => [r.variation_id, wanted.get(r.variation_id!)])),
        );
      } catch (error) {
        throw new AppError(
          `Square refused the new SKUs: ${error instanceof Error ? error.message : 'unknown reason'}. No labels were made.`,
          502,
        );
      }
      for (const r of inSquare)
        if (!saved.includes(r.variation_id!)) wanted.delete(r.variation_id!);
    }
    for (const [variationId, sku] of wanted)
      await this.db.exec(
        'update public.catalog_variations set sku = $2 where square_variation_id = $1',
        [variationId, sku],
      );
    if (wanted.size)
      await this.log.write(adminId, 'products.skus_assigned', 'labels', {
        skus: Object.fromEntries(wanted),
      });

    const byId = new Map(rows.map((r) => [r.id, r]));
    const labels = ids
      .map((id) => byId.get(id))
      .filter((r): r is LabelRow => !!r)
      .map((r) => ({
        id: r.id,
        name: r.name,
        series: r.series,
        code: r.sku ?? (r.variation_id ? (wanted.get(r.variation_id) ?? null) : null),
        inSquare: r.source === 'square' && r.is_active,
        upc: r.upc,
        stock: r.stock,
      }));
    return { labels, assigned: wanted.size };
  }

  /** `count` new shop SKUs that no variation uses yet. */
  private async uniqueSkus(count: number): Promise<string[]> {
    const out = new Set<string>();
    while (out.size < count) {
      const candidates = Array.from({ length: count - out.size }, shopSku).filter(
        (s) => !out.has(s),
      );
      const taken = await this.db.many<{ sku: string }>(
        'select sku from public.catalog_variations where upper(sku) = any($1::text[])',
        [candidates],
      );
      const used = new Set(taken.map((t) => t.sku.toUpperCase()));
      for (const c of candidates) if (!used.has(c)) out.add(c);
    }
    return [...out];
  }
}
