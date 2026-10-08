import type { ExternalJson } from '../../common/external-json.js';
import { isHiddenFromWebsite } from '../../integrations/square/visibility.js';

/** A catalog item ready to be saved (one object of `jsonb_to_recordset` in the sync's INSERT). */
export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  category_ids: string[];
  default_variation_id: string | null;
  active: boolean;
  visible: boolean;
  updated_at: string | null;
  /** When the item was created in Square. */
  created_at: string | null;
}
export interface VariationRow {
  id: string;
  item_id: string;
  name: string | null;
  sku: string | null;
  upc: string | null;
  price: number;
  sellable: boolean;
  updated_at: string | null;
}
export interface ImageRow {
  item_id: string;
  image_id: string;
  url: string;
  sort: number;
}

/**
 * Turns one page of Square catalog JSON into the rows we store. Pure: no database, no network.
 *
 * @param items the `items` of a search-catalog-items page (anything that is not an ITEM is skipped)
 * @param related the picture records for the page (looked up by id: the item search does not return them)
 * @param categories Square category id -> name
 */
export function mapCatalogPage(
  items: ExternalJson[],
  related: ExternalJson[],
  categories: Map<string, string>,
) {
  const images = new Map(
    related
      .filter((o) => o.type === 'IMAGE')
      .map((o) => [o.id, o.image_data?.url as string | undefined]),
  );
  const catalogItems = items.filter((i) => i.type === 'ITEM' && i.item_data);

  const productRows: ProductRow[] = [];
  const variationRows: VariationRow[] = [];
  const imageRows = new Map<string, ImageRow>(); // keyed by Square image id; a shared image goes to the last item
  for (const item of catalogItems) {
    const d = item.item_data;
    // Newer Square items carry `categories`; older ones only `category_id`.
    const categoryIds: string[] =
      d.categories?.map((c: ExternalJson) => c.id) ?? (d.category_id ? [d.category_id] : []);
    const primary = d.reporting_category?.id ?? categoryIds[0] ?? null;
    const live = (d.variations ?? []).filter((v: ExternalJson) => !v.is_deleted);
    productRows.push({
      id: item.id,
      name: d.name,
      description: d.description_plaintext ?? d.description ?? null,
      category: primary ? (categories.get(primary) ?? primary) : null,
      category_ids: categoryIds,
      default_variation_id: live[0]?.id ?? null,
      active: !item.is_deleted,
      // Hidden when it carries our "not for the website" category (the admin toggle and the cashier tool set it)
      // or when Square itself says so (online visibility "Hidden", or not sold at this location).
      visible: !item.is_deleted && !isHiddenFromWebsite(item),
      updated_at: item.updated_at ?? null,
      created_at: item.created_at ?? null,
    });
    for (const v of d.variations ?? []) {
      const vd = v.item_variation_data ?? {};
      variationRows.push({
        id: v.id,
        item_id: item.id,
        name: vd.name ?? null,
        sku: vd.sku ?? null,
        upc: vd.upc ?? null,
        price: Number(vd.price_money?.amount ?? 0),
        sellable: !v.is_deleted,
        updated_at: v.updated_at ?? item.updated_at ?? null,
      });
    }
    (d.image_ids ?? []).forEach((imageId: string, sort: number) => {
      const url = images.get(imageId);
      if (url) imageRows.set(imageId, { item_id: item.id, image_id: imageId, url, sort });
    });
  }
  return { catalogItems, productRows, variationRows, imageRows };
}
