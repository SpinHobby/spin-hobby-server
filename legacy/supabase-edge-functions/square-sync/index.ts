import { corsHeaders, failure, isAllowedOrigin, response } from '../_shared/http.ts';
import { currentUser, serviceClient } from '../_shared/supabase.ts';

type Row = Record<string, any>;

const squareBase = () => Deno.env.get('SQUARE_ENV') === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

function chunks<T>(values: T[], size = 100) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function squareFetch(path: string, body: Row) {
  const token = Deno.env.get('SQUARE_ACCESS_TOKEN');
  if (!token) throw new Error('Square catalog sync is not configured.');
  const result = await fetch(`${squareBase()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(data.errors?.[0]?.detail ?? 'Square catalog request failed.');
  return data;
}

async function ownerOrSyncSecret(req: Request) {
  const expected = Deno.env.get('SQUARE_SYNC_TRIGGER_SECRET');
  if (expected && req.headers.get('x-square-sync-secret') === expected) return;
  const db = serviceClient();
  const user = await currentUser(req, db);
  if (user?.role === 'owner') return;
  throw new Error('You do not have permission to start a Square sync.');
}

async function fetchCategoryNames() {
  const names = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const data = await squareFetch('/v2/catalog/search', {
      object_types: ['CATEGORY'], include_deleted_objects: false, limit: 100, ...(cursor ? { cursor } : {}),
    });
    for (const object of data.objects ?? []) if (object.type === 'CATEGORY' && object.category_data?.name) names.set(object.id, object.category_data.name);
    cursor = data.cursor;
  } while (cursor);
  return names;
}

async function upsertCatalogPage(db: ReturnType<typeof serviceClient>, items: Row[], related: Row[], categories: Map<string, string>) {
  const images = new Map((related ?? []).filter((object) => object.type === 'IMAGE').map((object) => [object.id, object.image_data?.url]));
  const products = items.filter((item) => item.type === 'ITEM' && item.item_data).map((item) => ({
    square_item_id: item.id,
    name: item.item_data.name,
    description: item.item_data.description ?? null,
    category: categories.get(item.item_data.category_id) ?? item.item_data.category_id ?? null,
    category_ids: item.item_data.category_id ? [item.item_data.category_id] : [],
    default_variation_id: null,
    is_active: !item.is_deleted,
    is_visible: !item.is_deleted,
    square_updated_at: item.updated_at ?? null,
    synced_at: new Date().toISOString(),
  }));
  if (!products.length) return { products: 0, variations: 0 };
  const { error: productError } = await db.from('catalog_products').upsert(products, { onConflict: 'square_item_id' });
  if (productError) throw productError;

  const variations = items.flatMap((item) => (item.item_data.variations ?? []).map((variation: Row) => ({
    square_variation_id: variation.id,
    square_item_id: item.id,
    name: variation.item_variation_data?.name ?? null,
    sku: variation.item_variation_data?.sku ?? null,
    price_cents: Number(variation.item_variation_data?.price_money?.amount ?? 0),
    currency: variation.item_variation_data?.price_money?.currency ?? 'CAD',
    is_sellable: !variation.is_deleted,
    square_updated_at: variation.updated_at ?? item.updated_at ?? null,
    synced_at: new Date().toISOString(),
  })));
  if (variations.length) {
    const { error } = await db.from('catalog_variations').upsert(variations, { onConflict: 'square_variation_id' });
    if (error) throw error;
  }
  for (const item of items) {
    const firstVariation = item.item_data?.variations?.find((variation: Row) => !variation.is_deleted)?.id ?? null;
    const { error } = await db.from('catalog_products').update({ default_variation_id: firstVariation }).eq('square_item_id', item.id);
    if (error) throw error;
    const { error: deleteError } = await db.from('product_images').delete().eq('square_item_id', item.id);
    if (deleteError) throw deleteError;
    const imageRows = (item.item_data?.image_ids ?? [])
      .map((imageId: string, sortOrder: number) => ({ square_item_id: item.id, square_image_id: imageId, image_url: images.get(imageId), sort_order: sortOrder }))
      .filter((image: Row) => image.image_url);
    if (imageRows.length) {
      const { error: imageError } = await db.from('product_images').insert(imageRows);
      if (imageError) throw imageError;
    }
  }
  return { products: products.length, variations: variations.length };
}

async function syncInventory(db: ReturnType<typeof serviceClient>, variationIds: string[]) {
  const locationId = Deno.env.get('SQUARE_LOCATION_ID');
  if (!locationId || !variationIds.length) return 0;
  let synced = 0;
  for (const ids of chunks(variationIds)) {
    let cursor: string | undefined;
    const quantities = new Map<string, number>();
    do {
      const data = await squareFetch('/v2/inventory/counts/batch-retrieve', {
        catalog_object_ids: ids, location_ids: [locationId], states: ['IN_STOCK'], ...(cursor ? { cursor } : {}),
      });
      for (const count of data.counts ?? []) quantities.set(count.catalog_object_id, (quantities.get(count.catalog_object_id) ?? 0) + Number(count.quantity ?? 0));
      cursor = data.cursor;
    } while (cursor);
    const records = ids.map((id) => ({ square_variation_id: id, quantity: quantities.has(id) ? quantities.get(id) : 0, synced_at: new Date().toISOString() }));
    const { error } = await db.from('inventory_snapshots').upsert(records, { onConflict: 'square_variation_id' });
    if (error) throw error;
    synced += records.length;
  }
  return synced;
}

async function runSync() {
  const db = serviceClient();
  const categories = await fetchCategoryNames();
  let cursor: string | undefined;
  let productCount = 0;
  let variationCount = 0;
  const variationIds: string[] = [];
  do {
    const data = await squareFetch('/v2/catalog/search-catalog-items', {
      product_types: ['REGULAR'], include_related_objects: true, limit: 100, ...(cursor ? { cursor } : {}),
    });
    const items = data.items ?? [];
    const result = await upsertCatalogPage(db, items, data.related_objects ?? [], categories);
    productCount += result.products;
    variationCount += result.variations;
    for (const item of items) for (const variation of item.item_data?.variations ?? []) if (!variation.is_deleted) variationIds.push(variation.id);
    cursor = data.cursor;
  } while (cursor);
  const inventoryCount = await syncInventory(db, variationIds);
  return { products: productCount, variations: variationCount, inventory: inventoryCount, completedAt: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (!isAllowedOrigin(req)) return failure(req, 'Origin is not allowed.', 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return failure(req, 'Method not allowed.', 405);
  try {
    await ownerOrSyncSecret(req);
    return response(req, { success: true, ...(await runSync()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Square sync failed.';
    return failure(req, message, message.includes('permission') ? 403 : 400);
  }
});
