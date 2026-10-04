import { CASHIER_CATEGORY_ID } from '../../config/square.config.js';

// The parts of Square's catalog objects the cashier screens use (the SDK's own types are far larger).
interface SquareVariation {
  id?: string;
  type?: string;
  itemVariationData?: { priceMoney?: { amount?: bigint | number | string } };
}
export interface SquareItem {
  id?: string;
  type?: string;
  itemData?: {
    name?: string;
    description?: string;
    categories?: { id?: string }[];
    imageIds?: string[];
    variations?: SquareVariation[];
  };
}
export interface SquareRelated {
  id?: string;
  type?: string;
  imageData?: { url?: string };
}
export interface SquareCategory {
  id?: string;
  categoryData?: { name?: string };
}
type StockByVariation = Record<string, number>;

/** The id of the item's first variation, which is the one the shop sells. */
export const firstVariationId = (item: SquareItem) => item.itemData?.variations?.[0]?.id;

/** Image id -> URL for the pictures Square returned alongside the items. */
export function imageUrls(related: SquareRelated[]) {
  const urls = new Map<string, string>();
  for (const object of related) {
    if (object.type === 'IMAGE' && object.id && object.imageData?.url)
      urls.set(object.id, object.imageData.url);
  }
  return urls;
}

/** Category id -> name. */
export function categoryNames(categories: SquareCategory[]) {
  const names = new Map<string, string>();
  for (const c of categories)
    if (c.id && c.categoryData?.name) names.set(c.id, c.categoryData.name);
  return names;
}

/** The shop category (not the hidden-convention marker category), and whether the item is marked hidden. */
export function classify(item: SquareItem) {
  const categories = item.itemData?.categories ?? [];
  return {
    categoryId: categories.find((c) => c.id !== CASHIER_CATEGORY_ID)?.id,
    hidden: categories.some((c) => c.id === CASHIER_CATEGORY_ID),
  };
}

/** One row of the cashier's search results. */
export function toSearchResult(
  item: SquareItem,
  images: Map<string, string>,
  names: Map<string, string>,
  stock: StockByVariation,
) {
  const variationId = firstVariationId(item);
  const { categoryId, hidden } = classify(item);
  const imageId = item.itemData?.imageIds?.[0];
  return {
    id: item.id,
    name: item.itemData?.name,
    priceCents: Number(item.itemData?.variations?.[0]?.itemVariationData?.priceMoney?.amount ?? 0),
    hidden,
    imageUrl: imageId ? images.get(imageId) : undefined,
    categoryId,
    categoryName: categoryId ? names.get(categoryId) : undefined,
    stockCount: variationId && variationId in stock ? stock[variationId] : null,
  };
}

/** The full item the cashier edits. */
export function toDetail(
  item: SquareItem,
  related: SquareRelated[],
  categories: SquareCategory[],
  stock: StockByVariation,
) {
  const imageId = item.itemData?.imageIds?.[0];
  const variation = item.itemData?.variations?.[0];
  const variationId = variation?.type === 'ITEM_VARIATION' ? variation.id : undefined;
  const { categoryId, hidden } = classify(item);
  return {
    id: item.id,
    name: item.itemData?.name,
    description: item.itemData?.description,
    priceCents:
      variation?.type === 'ITEM_VARIATION'
        ? Number(variation.itemVariationData?.priceMoney?.amount ?? 0)
        : 0,
    variationId,
    categoryId,
    categoryName: categoryId ? categoryNames(categories).get(categoryId) : undefined,
    hidden,
    stockCount: variationId && variationId in stock ? stock[variationId] : null,
    imageUrl: imageId ? imageUrls(related).get(imageId) : undefined,
  };
}
