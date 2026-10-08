import type { ExternalJson } from '../../common/external-json.js';
import { CASHIER_CATEGORY_ID, squareLocationId } from '../../config/square.config.js';

/** The category ids of a Square item (newer items carry `categories`, older ones only `category_id`). */
export function categoryIdsOf(item: ExternalJson): string[] {
  const data = item.item_data ?? {};
  return (
    data.categories?.map((c: ExternalJson) => c.id) ?? (data.category_id ? [data.category_id] : [])
  );
}

/** Hidden by us: the item carries the "not for the website" category (see CASHIER_CATEGORY_ID). */
export const isMarkedHidden = (item: ExternalJson) =>
  categoryIdsOf(item).includes(CASHIER_CATEGORY_ID);

/**
 * Hidden by Square itself, outside our app: Square's own online visibility is "Hidden", or the item is not
 * sold at our location (a staff member switched that location off in the Square Dashboard).
 * Only explicit settings count; an item that simply has no such data is not hidden.
 */
export function isHiddenInSquareItself(item: ExternalJson, locationId = squareLocationId()) {
  if (item.item_data?.ecom_visibility === 'HIDDEN') return true;
  if (!locationId) return false;
  if ((item.absent_at_location_ids ?? []).includes(locationId)) return true;
  return (
    item.present_at_all_locations === false &&
    Array.isArray(item.present_at_location_ids) &&
    !item.present_at_location_ids.includes(locationId)
  );
}

/** Is this item kept off the website according to Square? */
export const isHiddenFromWebsite = (item: ExternalJson, locationId = squareLocationId()) =>
  isMarkedHidden(item) || isHiddenInSquareItself(item, locationId);
