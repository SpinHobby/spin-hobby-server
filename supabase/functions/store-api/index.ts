import { type SupabaseClient } from 'npm:@supabase/supabase-js@2.95.3';
import { bodyAsJson, corsHeaders, failure, isAllowedOrigin, optionalString, parseRoute, positiveInteger, response, safeLike, stringValue } from '../_shared/http.ts';
import { currentUser, requireAdmin, requireUser, serviceClient, writeAdminLog, type AppUser } from '../_shared/supabase.ts';

type Row = Record<string, any>;
type QuoteLine = {
  variationId: string;
  itemId: string;
  name: string;
  imageUrl: string | null;
  unitPriceCents: number;
  quantity: number;
  isPreorder: boolean;
  lineCents: number;
};
type Quote = {
  lines: QuoteLine[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  currency: 'CAD';
  warnings: { variationId: string; code: string; message: string }[];
};

const paypalBase = () => Deno.env.get('PAYPAL_ENV') === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';
const squareBase = () => Deno.env.get('SQUARE_ENV') === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

function message(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected server error occurred.';
}

function cents(value: number) {
  return (value / 100).toFixed(2);
}

function publicProduct(product: Row) {
  return {
    id: product.id,
    variationId: product.variation_id,
    name: product.name,
    series: product.series,
    character: product.character,
    category: product.category,
    categoryId: product.category_id ?? null,
    images: product.images ?? [],
    priceCents: product.price_cents,
    compareAtCents: product.compare_at_cents,
    currency: product.currency,
    status: product.status,
    stockCount: product.stock_count,
    releaseMonth: product.release_month,
    orderByDate: product.order_by_date,
    rank: product.rank,
    maxPerCustomer: product.max_per_customer,
  };
}

async function settings(db: SupabaseClient) {
  const { data, error } = await db.from('store_settings').select('*').eq('id', true).single();
  if (error) throw error;
  return data as Row;
}

async function productPage(db: SupabaseClient, url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 24), 1), 60);
  const offset = Math.max(Number(url.searchParams.get('cursor') ?? 0), 0);
  const category = optionalString(url.searchParams.get('category'), 120);
  const statuses = (url.searchParams.get('status') ?? '').split(',').filter(Boolean).slice(0, 5);
  const sort = url.searchParams.get('sort') ?? 'new';
  const min = Number(url.searchParams.get('min'));
  const max = Number(url.searchParams.get('max'));
  const q = safeLike(url.searchParams.get('q') ?? '');

  let query = db.from('storefront_products').select('*', { count: 'exact' });
  if (category) query = query.eq('category', category);
  if (statuses.length) query = query.in('status', statuses);
  if (Number.isFinite(min) && min >= 0) query = query.gte('price_cents', Math.round(min * 100));
  if (Number.isFinite(max) && max >= 0) query = query.lte('price_cents', Math.round(max * 100));
  if (q) query = query.or(`name.ilike.%${q}%,series.ilike.%${q}%,character.ilike.%${q}%,jan_code.ilike.%${q}%`);

  if (sort === 'release') query = query.order('release_month', { ascending: true, nullsFirst: false });
  else if (sort === 'price_asc') query = query.order('price_cents', { ascending: true });
  else if (sort === 'price_desc') query = query.order('price_cents', { ascending: false });
  else if (sort === 'pop') query = query.order('rank', { ascending: true, nullsFirst: false });
  else query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  const total = count ?? 0;
  const next = offset + (data?.length ?? 0);
  return { success: true, items: (data ?? []).map(publicProduct), total, ...(next < total ? { cursor: String(next) } : {}) };
}

async function productFacets(db: SupabaseClient) {
  const { data, error } = await db.from('storefront_products').select('category,status,price_cents');
  if (error) throw error;
  const rows = data ?? [];
  const categories = new Map<string, number>();
  const status = { in: 0, pre: 0, out: 0 };
  const buckets = [
    { label: 'Under $25', min: 0, max: 25, count: 0 },
    { label: '$25–75', min: 25, max: 75, count: 0 },
    { label: '$75–150', min: 75, max: 150, count: 0 },
    { label: '$150+', min: 150, max: null as number | null, count: 0 },
  ];
  for (const row of rows) {
    if (row.category) categories.set(row.category, (categories.get(row.category) ?? 0) + 1);
    if (row.status === 'in' || row.status === 'low') status.in += 1;
    else if (row.status === 'pre') status.pre += 1;
    else if (row.status === 'out' || row.status === 'closed') status.out += 1;
    const price = Number(row.price_cents) / 100;
    const bucket = buckets.find((entry) => price >= entry.min && (entry.max === null || price < entry.max));
    if (bucket) bucket.count += 1;
  }
  return {
    success: true,
    categories: [...categories].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)),
    status,
    price: buckets,
  };
}

// ---------------------------------------------------------------- shop categories

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function categoryIdValue(value: unknown): string | null {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid category.');
  return value;
}

async function assertCategoryExists(db: SupabaseClient, id: string | null) {
  if (!id) return;
  const { data, error } = await db.from('store_categories').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Category not found.');
}

/** Visible categories as a flat list; a hidden category hides its whole branch. */
async function visibleCategories(db: SupabaseClient) {
  const { data, error } = await db.from('store_categories').select('id,parent_id,name,sort_order').eq('is_visible', true).order('sort_order').order('name');
  if (error) throw error;
  const rows = data ?? [];
  const byId = new Map(rows.map((r: Row) => [r.id, r]));
  const reachable = (r: Row): boolean => r.parent_id === null || (byId.has(r.parent_id) && reachable(byId.get(r.parent_id) as Row));
  return rows.filter(reachable).map((r: Row) => ({ id: r.id, parentId: r.parent_id, name: r.name, sortOrder: r.sort_order }));
}

async function adminCategories(req: Request, db: SupabaseClient, path: string) {
  const admin = await requireAdmin(req, db);
  const duplicateName = (error: Row) => { if (error?.code === '23505') throw new Error('A category with that name already exists here.'); throw error; };
  const cleanName = (value: unknown) => stringValue(value, 'name', 80).replace(/\s+/g, ' ');
  const nextSort = async (parentId: string | null) => {
    let query = db.from('store_categories').select('sort_order').order('sort_order', { ascending: false }).limit(1);
    query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
    const { data, error } = await query;
    if (error) throw error;
    return data?.length ? Number(data[0].sort_order) + 1 : 0;
  };

  if (path === '/admin/categories' && req.method === 'GET') {
    const [{ data: cats, error }, { data: products, error: productError }] = await Promise.all([
      db.from('store_categories').select('*').order('sort_order').order('name'),
      db.from('storefront_products').select('category_id').not('category_id', 'is', null),
    ]);
    if (error) throw error;
    if (productError) throw productError;
    const counts = new Map<string, number>();
    for (const row of products ?? []) counts.set(row.category_id, (counts.get(row.category_id) ?? 0) + 1);
    return { success: true, categories: (cats ?? []).map((c: Row) => ({ id: c.id, parentId: c.parent_id, name: c.name, sortOrder: c.sort_order, isVisible: c.is_visible, productCount: counts.get(c.id) ?? 0 })) };
  }

  if (path === '/admin/categories' && req.method === 'POST') {
    const payload = await bodyAsJson(req);
    const parentId = categoryIdValue(payload.parentId);
    if (parentId) await assertCategoryExists(db, parentId);
    const name = cleanName(payload.name);
    const { data, error } = await db.from('store_categories').insert({ parent_id: parentId, name, sort_order: await nextSort(parentId), is_visible: payload.isVisible !== false }).select().single();
    if (error) duplicateName(error);
    await writeAdminLog(db, admin.id, 'category.created', data.id, { name, parentId });
    return { success: true, category: { id: data.id, parentId: data.parent_id, name: data.name, sortOrder: data.sort_order, isVisible: data.is_visible, productCount: 0 } };
  }

  if (path === '/admin/categories/reorder' && req.method === 'PUT') {
    const ids = (await bodyAsJson(req)).ids;
    if (!Array.isArray(ids) || ids.length > 500 || ids.some((id) => typeof id !== 'string' || !UUID.test(id))) throw new Error('ids is required.');
    for (const [sortOrder, id] of (ids as string[]).entries()) {
      const { error } = await db.from('store_categories').update({ sort_order: sortOrder }).eq('id', id);
      if (error) throw error;
    }
    await writeAdminLog(db, admin.id, 'category.reordered', 'store_categories', { count: ids.length });
    return { success: true };
  }

  const id = /^\/admin\/categories\/([0-9a-f-]{36})$/i.exec(path)?.[1];
  if (!id) throw new Error('Route not found.');
  const { data: all, error: allError } = await db.from('store_categories').select('id,parent_id,name');
  if (allError) throw allError;
  const current = (all ?? []).find((c: Row) => c.id === id);
  if (!current) throw new Error('Category not found.');

  if (req.method === 'PUT') {
    const payload = await bodyAsJson(req);
    const changes: Row = {};
    if ('name' in payload) changes.name = cleanName(payload.name);
    if ('isVisible' in payload) changes.is_visible = payload.isVisible === true;
    if ('parentId' in payload) {
      const parentId = categoryIdValue(payload.parentId);
      if (parentId) {
        if (!(all ?? []).some((c: Row) => c.id === parentId)) throw new Error('Parent category not found.');
        for (let at: string | null = parentId; at; at = (all ?? []).find((c: Row) => c.id === at)?.parent_id ?? null) {
          if (at === id) throw new Error("A category can't be moved inside itself.");
        }
      }
      if (parentId !== current.parent_id) { changes.parent_id = parentId; changes.sort_order = await nextSort(parentId); }
    }
    if (Object.keys(changes).length) {
      const { error } = await db.from('store_categories').update(changes).eq('id', id);
      if (error) duplicateName(error);
      await writeAdminLog(db, admin.id, 'category.updated', id, changes);
    }
    return { success: true };
  }

  if (req.method === 'DELETE') {
    const subtree = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of all ?? []) if (c.parent_id && subtree.has(c.parent_id) && !subtree.has(c.id)) { subtree.add(c.id); grew = true; }
    }
    const { count } = await db.from('product_metadata').select('square_item_id', { count: 'exact', head: true }).in('category_id', [...subtree]);
    const { error } = await db.from('store_categories').delete().eq('id', id);
    if (error) throw error;
    await writeAdminLog(db, admin.id, 'category.deleted', id, { name: current.name, subcategories: subtree.size - 1, products: count ?? 0 });
    return { success: true, deletedCategories: subtree.size, uncategorisedProducts: count ?? 0 };
  }
  throw new Error('Route not found.');
}

async function bulkCategory(req: Request, db: SupabaseClient) {
  const admin = await requireAdmin(req, db);
  const payload = await bodyAsJson(req);
  const ids = payload.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some((id) => typeof id !== 'string')) throw new Error('Select at least one product.');
  const target = categoryIdValue(payload.categoryId);
  await assertCategoryExists(db, target);
  const { data: existing, error } = await db.from('catalog_products').select('square_item_id').in('square_item_id', ids);
  if (error) throw error;
  const rows = (existing ?? []).map((p: Row) => ({ square_item_id: p.square_item_id, category_id: target }));
  if (rows.length) {
    const { error: upsertError } = await db.from('product_metadata').upsert(rows, { onConflict: 'square_item_id' });
    if (upsertError) throw upsertError;
  }
  await writeAdminLog(db, admin.id, 'product.bulk_category', target ?? 'none', { count: rows.length });
  return { success: true, updated: rows.length };
}

async function homepage(db: SupabaseClient) {
  const [slides, featured, preorders, ranking, newInStock, events] = await Promise.all([
    db.from('hero_slides').select('*').eq('is_visible', true).order('sort_order'),
    db.from('storefront_products').select('*').eq('is_featured', true).order('sort_order').limit(8),
    db.from('storefront_products').select('*').eq('status', 'pre').order('order_by_date', { ascending: true, nullsFirst: false }).limit(12),
    db.from('storefront_products').select('*').not('rank', 'is', null).order('rank').limit(5),
    db.from('storefront_products').select('*').in('status', ['in', 'low']).order('updated_at', { ascending: false }).limit(5),
    db.from('store_events').select('*').eq('is_visible', true).order('sort_order'),
  ]);
  for (const result of [slides, featured, preorders, ranking, newInStock, events]) if (result.error) throw result.error;
  const categories = await visibleCategories(db);
  return {
    success: true,
    slides: slides.data,
    featuredItems: (featured.data ?? []).map(publicProduct),
    preorders: (preorders.data ?? []).map(publicProduct),
    ranking: (ranking.data ?? []).map(publicProduct),
    newInStock: (newInStock.data ?? []).map(publicProduct),
    events: events.data,
    categories,
  };
}

async function customerWishlist(req: Request, db: SupabaseClient) {
  const user = await requireUser(req, db);
  const { data: entries, error } = await db
    .from('wishlist_items')
    .select('square_item_id, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const ids = (entries ?? []).map((entry: Row) => entry.square_item_id);
  if (!ids.length) return { success: true, items: [] };
  const { data, error: productsError } = await db.from('storefront_products').select('*').in('id', ids);
  if (productsError) throw productsError;
  const products = new Map((data ?? []).map((product: Row) => [product.id, publicProduct(product)]));
  return { success: true, items: ids.map((id) => products.get(id)).filter(Boolean) };
}

async function addWishlist(req: Request, db: SupabaseClient) {
  const user = await requireUser(req, db);
  const payload = await bodyAsJson(req);
  const squareItemId = stringValue(payload.squareItemId, 'squareItemId', 120);
  const { data: product, error: productError } = await db.from('storefront_products').select('id').eq('id', squareItemId).maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error('This product is not available.');
  const { error } = await db.from('wishlist_items').upsert({ user_id: user.id, square_item_id: squareItemId });
  if (error) throw error;
  return { success: true };
}

async function removeWishlist(req: Request, db: SupabaseClient, squareItemId: string) {
  const user = await requireUser(req, db);
  const { error } = await db.from('wishlist_items').delete().eq('user_id', user.id).eq('square_item_id', squareItemId);
  if (error) throw error;
  return { success: true };
}

async function createAlert(req: Request, db: SupabaseClient) {
  const payload = await bodyAsJson(req);
  const email = stringValue(payload.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  const variationId = stringValue(payload.variationId, 'variationId', 120);
  const { data: variation, error: variationError } = await db
    .from('catalog_variations')
    .select('square_variation_id')
    .eq('square_variation_id', variationId)
    .maybeSingle();
  if (variationError) throw variationError;
  if (!variation) throw new Error('This product variation is not available.');
  const user = await currentUser(req, db);
  const { error } = await db.from('stock_alerts').upsert({
    email,
    square_variation_id: variationId,
    user_id: user?.id ?? null,
    notified_at: null,
  }, { onConflict: 'email,square_variation_id' });
  if (error) throw error;
  return { success: true };
}

async function quoteCart(db: SupabaseClient, input: Record<string, unknown>): Promise<Quote> {
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 40) throw new Error('Your cart must contain between 1 and 40 items.');
  const shippingMethod = input.shippingMethod === 'express' ? 'express' : input.shippingMethod === 'standard' ? 'standard' : null;
  const country = input.country === 'CA' || input.country === 'US' ? input.country : null;
  const province = typeof input.province === 'string' ? input.province.toUpperCase().trim() : '';
  if (!shippingMethod || !country || !province) throw new Error('A shipping method, country, and province are required.');

  const quantities = new Map<string, number>();
  for (const line of input.items) {
    if (!line || typeof line !== 'object') throw new Error('Invalid cart line.');
    const value = line as Record<string, unknown>;
    const variationId = stringValue(value.variationId, 'variationId', 120);
    const quantity = positiveInteger(value.quantity, 'quantity');
    quantities.set(variationId, (quantities.get(variationId) ?? 0) + quantity);
  }
  for (const quantity of quantities.values()) if (quantity > 99) throw new Error('A product quantity cannot exceed 99.');
  const variationIds = [...quantities.keys()];

  const { data: variations, error: variationError } = await db
    .from('catalog_variations')
    .select('square_variation_id,square_item_id,name,price_cents,currency,is_sellable')
    .in('square_variation_id', variationIds);
  if (variationError) throw variationError;
  if ((variations ?? []).length !== variationIds.length) throw new Error('One or more products are no longer available.');

  const itemIds = [...new Set((variations ?? []).map((row: Row) => row.square_item_id))];
  const [productsResult, metadataResult, inventoryResult, imagesResult, settingsResult, taxResult] = await Promise.all([
    db.from('catalog_products').select('square_item_id,name,is_active,is_visible').in('square_item_id', itemIds),
    db.from('product_metadata').select('*').in('square_item_id', itemIds),
    db.from('inventory_snapshots').select('*').in('square_variation_id', variationIds),
    db.from('product_images').select('square_item_id,image_url,sort_order').in('square_item_id', itemIds).order('sort_order'),
    settings(db),
    db.from('tax_rates').select('rate').eq('country', country).eq('province', province).eq('enabled', true).maybeSingle(),
  ]);
  for (const result of [productsResult, metadataResult, inventoryResult, imagesResult, taxResult]) if (result.error) throw result.error;
  const products = new Map((productsResult.data ?? []).map((row: Row) => [row.square_item_id, row]));
  const metadata = new Map((metadataResult.data ?? []).map((row: Row) => [row.square_item_id, row]));
  const inventory = new Map((inventoryResult.data ?? []).map((row: Row) => [row.square_variation_id, row]));
  const image = new Map<string, string>();
  for (const row of imagesResult.data ?? []) if (!image.has(row.square_item_id)) image.set(row.square_item_id, row.image_url);

  const lines: QuoteLine[] = [];
  const warnings: Quote['warnings'] = [];
  for (const variation of variations ?? []) {
    const requested = quantities.get(variation.square_variation_id) ?? 0;
    const product = products.get(variation.square_item_id);
    const meta = metadata.get(variation.square_item_id);
    const stock = inventory.get(variation.square_variation_id)?.quantity;
    const preorder = meta?.availability === 'preorder' || meta?.availability === 'backorder';
    const closed = preorder && meta?.order_by_date && new Date(meta.order_by_date).getTime() < Date.now();
    if (!product?.is_active || !product.is_visible || meta?.availability === 'hidden' || !variation.is_sellable) {
      warnings.push({ variationId: variation.square_variation_id, code: 'OUT_OF_STOCK', message: `${variation.name ?? product?.name ?? 'This item'} is unavailable.` });
      continue;
    }
    if (closed) {
      warnings.push({ variationId: variation.square_variation_id, code: 'PREORDER_CLOSED', message: `${product.name} is no longer accepting pre-orders.` });
      continue;
    }
    const available = preorder || stock === null || stock === undefined ? requested : Math.min(requested, Math.max(0, Number(stock)));
    if (available < requested) warnings.push({
      variationId: variation.square_variation_id,
      code: available ? 'QTY_REDUCED' : 'OUT_OF_STOCK',
      message: available ? `Only ${available} of ${product.name} can be added.` : `${product.name} is sold out.`,
    });
    if (!available) continue;
    if (meta?.max_per_customer && available > meta.max_per_customer) {
      warnings.push({ variationId: variation.square_variation_id, code: 'LIMIT_EXCEEDED', message: `${product.name} is limited to ${meta.max_per_customer} per customer.` });
      continue;
    }
    lines.push({
      variationId: variation.square_variation_id,
      itemId: variation.square_item_id,
      name: product.name,
      imageUrl: image.get(variation.square_item_id) ?? null,
      unitPriceCents: Number(variation.price_cents),
      quantity: available,
      isPreorder: preorder,
      lineCents: Number(variation.price_cents) * available,
    });
  }
  const subtotalCents = lines.reduce((total, line) => total + line.lineCents, 0);
  const store = settingsResult;
  const shippingCents = shippingMethod === 'express'
    ? Number(store.shipping_express_cents)
    : subtotalCents >= Number(store.free_shipping_threshold_cents) ? 0 : Number(store.shipping_standard_cents);
  const taxCents = Math.round((subtotalCents + shippingCents) * Number(taxResult.data?.rate ?? 0));
  return { lines, subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents, currency: 'CAD', warnings };
}

async function paypalToken() {
  const clientId = Deno.env.get('PAYPAL_CLIENT_ID');
  const secret = Deno.env.get('PAYPAL_CLIENT_SECRET');
  if (!clientId || !secret) throw new Error('PayPal checkout is not configured.');
  const tokenResponse = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!tokenResponse.ok) throw new Error('PayPal authentication failed.');
  const token = await tokenResponse.json();
  return token.access_token as string;
}

async function createPayPalOrder(order: Row) {
  const token = await paypalToken();
  const result = await fetch(`${paypalBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `spin-hobby-${order.id}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(order.id),
        amount: { currency_code: 'CAD', value: cents(Number(order.total_cents)) },
        description: `Spin Hobby order #${order.id}`,
      }],
    }),
  });
  if (!result.ok) throw new Error('PayPal could not create a checkout order.');
  const payload = await result.json();
  return payload.id as string;
}

async function checkoutIntent(req: Request, db: SupabaseClient) {
  const payload = await bodyAsJson(req);
  const quoteInput = (payload.quoteInput ?? payload.quote) as Record<string, unknown>;
  if (!quoteInput || typeof quoteInput !== 'object' || Array.isArray(quoteInput)) throw new Error('quoteInput is required.');
  const email = stringValue(payload.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!payload.billing || typeof payload.billing !== 'object' || !payload.shipping || typeof payload.shipping !== 'object') throw new Error('Billing and shipping addresses are required.');
  const quote = await quoteCart(db, quoteInput);
  if (!quote.lines.length || quote.warnings.length) return { success: false, error: 'Your cart changed. Review the updated quote before checking out.', code: 'CART_CHANGED', quote };
  const user = await currentUser(req, db);
  const store = await settings(db);
  const { data: order, error: orderError } = await db.from('orders').insert({
    user_id: user?.id ?? null,
    provider: store.payment_provider,
    subtotal_cents: quote.subtotalCents,
    shipping_cents: quote.shippingCents,
    tax_cents: quote.taxCents,
    total_cents: quote.totalCents,
    shipping_method: quoteInput.shippingMethod,
    billing_email: email,
    billing_address: payload.billing,
    shipping_address: payload.shipping,
  }).select().single();
  if (orderError) throw orderError;
  const { error: lineError } = await db.from('order_items').insert(quote.lines.map((line) => ({
    order_id: order.id,
    square_item_id: line.itemId,
    square_variation_id: line.variationId,
    name: line.name,
    image_url: line.imageUrl,
    unit_price_cents: line.unitPriceCents,
    quantity: line.quantity,
    is_preorder: line.isPreorder,
  })));
  if (lineError) throw lineError;
  await db.from('order_events').insert({ order_id: order.id, actor_id: user?.id ?? null, event_type: 'created', data: { quote } });

  if (store.payment_provider === 'paypal') {
    try {
      const paypalOrderId = await createPayPalOrder(order);
      const { error } = await db.from('orders').update({ provider_metadata: { paypal_order_id: paypalOrderId } }).eq('id', order.id);
      if (error) throw error;
      return { success: true, orderId: order.id, provider: 'paypal', paypalOrderId };
    } catch (error) {
      await db.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
      throw error;
    }
  }
  return { success: true, orderId: order.id, provider: 'square', amountCents: quote.totalCents, currency: 'CAD', idempotencyKey: `spin-hobby-${order.id}` };
}

async function capturePayPal(req: Request, db: SupabaseClient) {
  const payload = await bodyAsJson(req);
  const paypalOrderId = stringValue(payload.paypalOrderId, 'paypalOrderId', 200);
  const { data: order, error } = await db.from('orders')
    .select('*')
    .eq('provider', 'paypal')
    .contains('provider_metadata', { paypal_order_id: paypalOrderId })
    .maybeSingle();
  if (error) throw error;
  if (!order) throw new Error('Checkout order not found.');
  if (order.status === 'paid' || order.status === 'preorder_reserved') return { success: true, orderId: order.id, status: order.status };
  if (order.status !== 'pending') throw new Error('This order can no longer be captured.');
  const token = await paypalToken();
  const capture = await fetch(`${paypalBase()}/v2/checkout/orders/${paypalOrderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `spin-hobby-capture-${order.id}` },
  });
  if (!capture.ok) throw new Error('PayPal could not capture this payment.');
  const result = await capture.json();
  if (result.status !== 'COMPLETED') throw new Error('PayPal did not complete this payment.');
  const captureId = result.purchase_units?.[0]?.payments?.captures?.[0]?.id;
  if (!captureId) throw new Error('PayPal did not return a payment ID.');
  const status = (await db.from('order_items').select('is_preorder').eq('order_id', order.id)).data?.some((item: Row) => item.is_preorder)
    ? 'preorder_reserved' : 'paid';
  const { error: updateError } = await db.from('orders').update({
    status,
    provider_payment_id: captureId,
    receipt_url: result.links?.find((link: Row) => link.rel === 'self')?.href ?? null,
  }).eq('id', order.id);
  if (updateError) throw updateError;
  await db.from('order_events').insert({ order_id: order.id, event_type: 'paid', data: { paypal_order_id: paypalOrderId, capture_id: captureId } });
  return { success: true, orderId: order.id, status };
}

async function squareRequest(path: string, payload: Record<string, unknown>, idempotencyKey?: string) {
  const accessToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
  if (!accessToken) throw new Error('Square Payments is not configured.');
  const result = await fetch(`${squareBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(payload),
  });
  const responseBody = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(responseBody.errors?.[0]?.detail ?? 'Square rejected the request.');
  return responseBody;
}

async function captureSquare(req: Request, db: SupabaseClient) {
  const payload = await bodyAsJson(req);
  const orderId = positiveInteger(payload.orderId, 'orderId', Number.MAX_SAFE_INTEGER);
  const sourceId = stringValue(payload.sourceId, 'sourceId', 500);
  const email = stringValue(payload.email, 'email', 254).toLowerCase();
  const locationId = Deno.env.get('SQUARE_LOCATION_ID');
  if (!locationId) throw new Error('Square Payments is not configured.');
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).eq('provider', 'square').eq('billing_email', email).maybeSingle();
  if (error) throw error;
  if (!order) throw new Error('Checkout order not found.');
  if (order.status === 'paid' || order.status === 'preorder_reserved') return { success: true, orderId: order.id, status: order.status };
  if (order.status !== 'pending') throw new Error('This order can no longer be captured.');
  const { data: lines, error: linesError } = await db.from('order_items').select('*').eq('order_id', order.id);
  if (linesError) throw linesError;

  let squareOrderId = order.square_order_id as string | null;
  if (!squareOrderId) {
    const squareOrder = await squareRequest('/v2/orders', {
      order: {
        location_id: locationId,
        reference_id: `spin-hobby-${order.id}`,
        line_items: (lines ?? []).map((line: Row) => ({
          // Hand-entered products don't exist in Square's catalog: send them as named ad-hoc items.
          ...(isManualId(line.square_item_id) ? {} : { catalog_object_id: line.square_variation_id }),
          name: line.name,
          quantity: String(line.quantity),
          base_price_money: { amount: line.unit_price_cents, currency: 'CAD' },
        })),
        service_charges: [
          ...(Number(order.shipping_cents) ? [{ name: 'Shipping', amount_money: { amount: order.shipping_cents, currency: 'CAD' } }] : []),
          ...(Number(order.tax_cents) ? [{ name: 'Sales tax', amount_money: { amount: order.tax_cents, currency: 'CAD' } }] : []),
        ],
      },
      idempotency_key: `spin-hobby-order-${order.id}`,
    }, `spin-hobby-order-${order.id}`);
    squareOrderId = squareOrder.order?.id;
    if (!squareOrderId) throw new Error('Square did not return an order ID.');
    const { error: updateError } = await db.from('orders').update({ square_order_id: squareOrderId }).eq('id', order.id);
    if (updateError) throw updateError;
  }

  const payment = await squareRequest('/v2/payments', {
    source_id: sourceId,
    idempotency_key: `spin-hobby-payment-${order.id}`,
    amount_money: { amount: order.total_cents, currency: 'CAD' },
    order_id: squareOrderId,
    location_id: locationId,
    buyer_email_address: order.billing_email,
    ...(typeof payload.verificationToken === 'string' ? { verification_token: payload.verificationToken } : {}),
  }, `spin-hobby-payment-${order.id}`);
  if (payment.payment?.status !== 'COMPLETED') throw new Error('Square did not complete this payment.');
  const status = (lines ?? []).some((line: Row) => line.is_preorder) ? 'preorder_reserved' : 'paid';
  const { error: updateError } = await db.from('orders').update({
    status,
    provider_payment_id: payment.payment.id,
    receipt_url: payment.payment.receipt_url ?? null,
  }).eq('id', order.id);
  if (updateError) throw updateError;
  await db.from('order_events').insert({ order_id: order.id, event_type: 'paid', data: { square_order_id: squareOrderId, payment_id: payment.payment.id } });
  return { success: true, orderId: order.id, status };
}

async function getOrders(req: Request, db: SupabaseClient) {
  const user = await requireUser(req, db);
  const { data, error } = await db.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) throw error;
  return { success: true, items: data ?? [] };
}

async function getOrder(req: Request, db: SupabaseClient, id: string) {
  const user = await requireUser(req, db);
  const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
  let query = db.from('orders').select('*,order_items(*),order_events(*)').eq('id', orderId);
  if (user.role === 'customer') query = query.eq('user_id', user.id);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Order not found.');
  return { success: true, order: data };
}

async function lookupOrder(req: Request, db: SupabaseClient, url: URL) {
  const paymentId = stringValue(url.searchParams.get('paymentId'), 'paymentId', 200);
  const email = stringValue(url.searchParams.get('email'), 'email', 254).toLowerCase();
  const { data, error } = await db.from('orders')
    .select('*,order_items(*)')
    .eq('provider_payment_id', paymentId)
    .eq('billing_email', email)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Order not found.');
  return { success: true, order: data };
}

function asBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

async function verifySquareSignature(req: Request, raw: string) {
  const signature = req.headers.get('x-square-hmacsha256-signature');
  const key = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY');
  const url = Deno.env.get('SQUARE_WEBHOOK_URL');
  if (!signature || !key || !url) return false;
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(url + raw)));
  try { return sameBytes(signed, asBytes(signature)); } catch { return false; }
}

async function squareWebhook(req: Request, db: SupabaseClient) {
  const raw = await req.text();
  if (!(await verifySquareSignature(req, raw))) return failure(req, 'Invalid Square webhook signature.', 401);
  const event = JSON.parse(raw) as Row;
  const eventId = stringValue(event.event_id, 'event_id', 200);
  const { error: insertError } = await db.from('webhook_events').insert({
    id: eventId, provider: 'square', event_type: event.type ?? 'unknown', payload: event,
  });
  if (insertError?.code === '23505') return response(req, { success: true, duplicate: true });
  if (insertError) throw insertError;
  const counts = event.data?.object?.inventory_counts;
  if (event.type === 'inventory.count.updated' && Array.isArray(counts)) {
    const rows = counts
      .filter((count: Row) => count.catalog_object_id)
      .map((count: Row) => ({ square_variation_id: count.catalog_object_id, quantity: count.quantity === undefined ? null : Number(count.quantity), square_updated_at: event.created_at ?? new Date().toISOString(), synced_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await db.from('inventory_snapshots').upsert(rows);
      if (error) throw error;
    }
  }
  const { error: processedError } = await db.from('webhook_events').update({ processed_at: new Date().toISOString() }).eq('id', eventId);
  if (processedError) throw processedError;
  return response(req, { success: true });
}

async function verifyPayPalWebhook(req: Request, raw: string) {
  const clientId = Deno.env.get('PAYPAL_CLIENT_ID');
  const secret = Deno.env.get('PAYPAL_CLIENT_SECRET');
  const webhookId = Deno.env.get('PAYPAL_WEBHOOK_ID');
  if (!clientId || !secret || !webhookId) return false;
  const token = await paypalToken();
  const payload = JSON.parse(raw);
  const result = await fetch(`${paypalBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: req.headers.get('paypal-auth-algo'),
      cert_url: req.headers.get('paypal-cert-url'),
      transmission_id: req.headers.get('paypal-transmission-id'),
      transmission_sig: req.headers.get('paypal-transmission-sig'),
      transmission_time: req.headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: payload,
    }),
  });
  if (!result.ok) return false;
  return (await result.json()).verification_status === 'SUCCESS';
}

async function paypalWebhook(req: Request, db: SupabaseClient) {
  const raw = await req.text();
  if (!(await verifyPayPalWebhook(req, raw))) return failure(req, 'Invalid PayPal webhook signature.', 401);
  const event = JSON.parse(raw) as Row;
  const eventId = stringValue(event.id, 'id', 200);
  const { error } = await db.from('webhook_events').insert({ id: eventId, provider: 'paypal', event_type: event.event_type ?? 'unknown', payload: event, processed_at: new Date().toISOString() });
  if (error?.code === '23505') return response(req, { success: true, duplicate: true });
  if (error) throw error;
  return response(req, { success: true });
}

async function adminDashboard(req: Request, db: SupabaseClient) {
  await requireAdmin(req, db);
  const [ordersResult, alertsResult, productsResult] = await Promise.all([
    db.from('orders').select('id,billing_email,total_cents,status,created_at').order('created_at', { ascending: false }).limit(100),
    db.from('stock_alerts').select('id', { count: 'exact', head: true }).is('notified_at', null),
    db.from('storefront_products').select('id,name,variation_id,stock_count,status,order_by_date'),
  ]);
  for (const result of [ordersResult, alertsResult, productsResult]) if (result.error) throw result.error;
  const orders = ordersResult.data ?? [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const toShip = orders.filter((order: Row) => order.status === 'paid');
  const preorders = orders.filter((order: Row) => order.status === 'preorder_reserved');
  const salesTodayCents = orders
    .filter((order: Row) => new Date(order.created_at) >= today && ['paid', 'preorder_reserved', 'fulfilled', 'shipped'].includes(order.status))
    .reduce((total: number, order: Row) => total + Number(order.total_cents), 0);
  const oldestToShipDays = toShip.length
    ? Math.floor((Date.now() - Math.min(...toShip.map((order: Row) => new Date(order.created_at).getTime()))) / 86_400_000)
    : 0;
  const products = productsResult.data ?? [];
  return {
    success: true,
    salesTodayCents,
    toShip: toShip.length,
    oldestToShipDays,
    openPreorders: preorders.length,
    reservedUnits: preorders.length,
    lowStock: products.filter((product: Row) => ['low', 'out'].includes(product.status)).length,
    alertsWaiting: alertsResult.count ?? 0,
    toShipList: toShip.slice(0, 8),
    lowStockList: products.filter((product: Row) => ['low', 'out'].includes(product.status)).slice(0, 8),
    closingPreorders: products.filter((product: Row) => product.status === 'pre' && product.order_by_date).sort((a: Row, b: Row) => String(a.order_by_date).localeCompare(String(b.order_by_date))).slice(0, 8),
  };
}

async function adminProducts(req: Request, db: SupabaseClient, url: URL) {
  await requireAdmin(req, db);
  const filter = url.searchParams.get('filter') ?? 'all';
  const clone = new URL(url);
  if (filter === 'in') clone.searchParams.set('status', 'in,low');
  if (filter === 'low') clone.searchParams.set('status', 'low,out');
  if (filter === 'pre') clone.searchParams.set('status', 'pre');
  const page = await productPage(db, clone);
  if (filter === 'featured') {
    const { data, error } = await db.from('product_metadata').select('square_item_id').eq('is_featured', true);
    if (error) throw error;
    const ids = new Set((data ?? []).map((row: Row) => row.square_item_id));
    page.items = page.items.filter((item: Row) => ids.has(item.id));
    page.total = page.items.length;
  }
  // Admin-only fields the storefront doesn't expose: JAN, availability, featured flag, waiting restock alerts.
  const itemIds = page.items.map((item: Row) => item.id);
  const variationIds = page.items.map((item: Row) => item.variationId).filter(Boolean);
  if (itemIds.length) {
    const [metaResult, catalogResult, alertResult] = await Promise.all([
      db.from('product_metadata').select('square_item_id,availability,jan_code,is_featured,sort_order').in('square_item_id', itemIds),
      db.from('catalog_products').select('square_item_id,source,description').in('square_item_id', itemIds),
      variationIds.length
        ? db.from('stock_alerts').select('square_variation_id').in('square_variation_id', variationIds).is('notified_at', null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (metaResult.error) throw metaResult.error;
    if (catalogResult.error) throw catalogResult.error;
    const catalogById = new Map((catalogResult.data ?? []).map((row: Row) => [row.square_item_id, row]));
    if (alertResult.error) throw alertResult.error;
    const meta = new Map((metaResult.data ?? []).map((row: Row) => [row.square_item_id, row]));
    const alerts = new Map<string, number>();
    for (const row of (alertResult.data ?? []) as Row[]) alerts.set(row.square_variation_id, (alerts.get(row.square_variation_id) ?? 0) + 1);
    page.items = page.items.map((item: Row) => {
      const m = meta.get(item.id) as Row | undefined;
      return { ...item, janCode: m?.jan_code ?? null, availability: m?.availability ?? 'auto', isFeatured: m?.is_featured ?? false, sortOrder: m?.sort_order ?? 0, source: (catalogById.get(item.id) as Row | undefined)?.source ?? 'square', description: (catalogById.get(item.id) as Row | undefined)?.description ?? null, alertsWaiting: alerts.get(item.variationId) ?? 0 };
    });
  }
  return page;
}

async function updateProduct(req: Request, db: SupabaseClient, squareItemId: string) {
  const admin = await requireAdmin(req, db);
  const payload = await bodyAsJson(req);
  const { data: product, error: productError } = await db.from('catalog_products').select('square_item_id').eq('square_item_id', squareItemId).maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error('Product not found.');
  const allowed = ['availability', 'release_month', 'order_by_date', 'series', 'character', 'manufacturer', 'jan_code', 'compare_at_cents', 'max_per_customer', 'deposit_cents', 'is_featured', 'sort_order', 'category_id'];
  const changes: Row = { square_item_id: squareItemId };
  for (const key of allowed) if (key in payload) changes[key] = payload[key] === '' ? null : payload[key];
  if (changes.availability && !['auto', 'preorder', 'backorder', 'hidden'].includes(changes.availability)) throw new Error('Invalid availability.');
  if ('category_id' in changes) { changes.category_id = categoryIdValue(changes.category_id); await assertCategoryExists(db, changes.category_id); }
  for (const key of ['compare_at_cents', 'max_per_customer', 'deposit_cents', 'sort_order']) {
    if (changes[key] !== undefined && changes[key] !== null && (!Number.isInteger(Number(changes[key])) || Number(changes[key]) < 0)) throw new Error(`Invalid ${key}.`);
  }
  const { data, error } = await db.from('product_metadata').upsert(changes).select().single();
  if (error) throw error;
  await writeAdminLog(db, admin.id, 'product.updated', squareItemId, changes);
  return { success: true, product: data };
}

// ---------------------------------------------------------------- manual merchandise + image uploads

const IMAGE_BUCKET = 'product-images';
const IMAGE_TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const isManualId = (id: string) => id.startsWith('manual-');

/** Admin UI resizes in the browser, then sends base64. Stored in the public product-images bucket. */
async function adminUpload(req: Request, db: SupabaseClient) {
  const admin = await requireAdmin(req, db);
  const payload = await bodyAsJson(req);
  const contentType = stringValue(payload.contentType, 'contentType', 40);
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new Error('Upload a WebP, JPEG or PNG image.');
  const folder = payload.folder === 'slides' ? 'slides' : 'products';
  const base64 = stringValue(payload.data, 'data', 8_000_000).replace(/^data:[^,]+,/, '');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { throw new Error('The image data is invalid.'); }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Images must be under 5 MB.');
  const path = `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from(IMAGE_BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
  if (error) throw error;
  const url = db.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  await writeAdminLog(db, admin.id, 'image.uploaded', path, { bytes: bytes.length });
  return { success: true, url, path, bytes: bytes.length };
}

function imageUrls(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error('Add up to 8 photos.');
  return value.map((url) => {
    const text = stringValue(url, 'image URL', 1000);
    if (!/^https:\/\//.test(text)) throw new Error('Photo URLs must start with https://');
    return text;
  });
}

function priceCentsValue(value: unknown) {
  const cents = Number(value);
  if (!Number.isInteger(cents) || cents <= 0 || cents > 10_000_000) throw new Error('Enter a price above $0.');
  return cents;
}

function stockValue(value: unknown) {
  if (value === null || value === '') return null; // untracked = unlimited
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty < 0 || qty > 100_000) throw new Error('Stock must be a whole number of 0 or more.');
  return qty;
}

async function replaceImages(db: SupabaseClient, itemId: string, urls: string[]) {
  const { error: deleteError } = await db.from('product_images').delete().eq('square_item_id', itemId);
  if (deleteError) throw deleteError;
  if (!urls.length) return;
  const { error } = await db.from('product_images').insert(urls.map((image_url, sort_order) => ({ square_item_id: itemId, image_url, sort_order })));
  if (error) throw error;
}

/** Creates merchandise that isn't in Square yet. Storefront, checkout and admin treat it like any product. */
async function createManualProduct(req: Request, db: SupabaseClient) {
  const admin = await requireAdmin(req, db);
  const p = await bodyAsJson(req);
  const name = stringValue(p.name, 'name', 200);
  const category = optionalString(p.category, 120);
  const priceCents = priceCentsValue(p.priceCents);
  const stock = stockValue(p.stockCount ?? null);
  const images = imageUrls(p.imageUrls ?? []) ?? [];
  const availability = p.availability === 'preorder' ? 'preorder' : 'auto';
  if (availability === 'preorder' && !p.orderByDate) throw new Error('Pre-orders need an order-by date.');
  const shopCategory = categoryIdValue(p.categoryId);
  await assertCategoryExists(db, shopCategory);
  const itemId = `manual-${crypto.randomUUID()}`;
  const variationId = `${itemId}-v`;

  const { error: productError } = await db.from('catalog_products').insert({
    square_item_id: itemId, name, description: optionalString(p.description, 2000), category,
    category_ids: [], is_active: true, is_visible: true, source: 'manual',
  });
  if (productError) throw productError;
  try {
    const { error: variationError } = await db.from('catalog_variations').insert({ square_variation_id: variationId, square_item_id: itemId, name: 'Regular', price_cents: priceCents });
    if (variationError) throw variationError;
    const writes = await Promise.all([
      db.from('catalog_products').update({ default_variation_id: variationId }).eq('square_item_id', itemId),
      db.from('inventory_snapshots').insert({ square_variation_id: variationId, quantity: stock }),
      db.from('product_metadata').insert({
        square_item_id: itemId, availability,
        release_month: optionalString(p.releaseMonth, 10) ? `${String(p.releaseMonth).slice(0, 7)}-01` : null,
        order_by_date: optionalString(p.orderByDate, 30),
        series: optionalString(p.series, 120),
        jan_code: optionalString(p.janCode, 20),
        compare_at_cents: p.compareAtCents ? priceCentsValue(p.compareAtCents) : null,
        max_per_customer: p.maxPerCustomer ? positiveInteger(p.maxPerCustomer, 'maxPerCustomer', 1000) : null,
        is_featured: p.isFeatured === true,
        category_id: shopCategory,
      }),
    ]);
    for (const { error } of writes) if (error) throw error;
    await replaceImages(db, itemId, images);
  } catch (error) {
    await db.from('catalog_products').delete().eq('square_item_id', itemId); // cascades to the rows above
    throw error;
  }
  await writeAdminLog(db, admin.id, 'product.created', itemId, { name, priceCents, stock });
  const { data } = await db.from('storefront_products').select('*').eq('id', itemId).maybeSingle();
  return { success: true, product: data ? { ...publicProduct(data), source: 'manual' } : { id: itemId } };
}

/** Name, price, category, stock and photos for hand-entered products (Square owns these for synced ones). */
async function updateManualProduct(req: Request, db: SupabaseClient, itemId: string) {
  const admin = await requireAdmin(req, db);
  if (!isManualId(itemId)) throw new Error('This product comes from Square. Edit its name, price, photos and stock in Square.');
  const p = await bodyAsJson(req);
  const { data: product, error: findError } = await db.from('catalog_products').select('default_variation_id').eq('square_item_id', itemId).maybeSingle();
  if (findError) throw findError;
  if (!product) throw new Error('Product not found.');
  const variationId = product.default_variation_id as string;
  const productChanges: Row = {};
  if ('name' in p) productChanges.name = stringValue(p.name, 'name', 200);
  if ('category' in p) productChanges.category = optionalString(p.category, 120);
  if ('description' in p) productChanges.description = optionalString(p.description, 2000);
  if (Object.keys(productChanges).length) {
    const { error } = await db.from('catalog_products').update(productChanges).eq('square_item_id', itemId);
    if (error) throw error;
  }
  if ('priceCents' in p) {
    const { error } = await db.from('catalog_variations').update({ price_cents: priceCentsValue(p.priceCents) }).eq('square_variation_id', variationId);
    if (error) throw error;
  }
  if ('stockCount' in p) {
    const { error } = await db.from('inventory_snapshots').upsert({ square_variation_id: variationId, quantity: stockValue(p.stockCount), synced_at: new Date().toISOString() });
    if (error) throw error;
  }
  const images = imageUrls(p.imageUrls);
  if (images) await replaceImages(db, itemId, images);
  await writeAdminLog(db, admin.id, 'product.catalog_updated', itemId, { ...productChanges, priceCents: p.priceCents, stockCount: p.stockCount, images: images?.length });
  return { success: true };
}

async function archiveManualProduct(req: Request, db: SupabaseClient, itemId: string) {
  const admin = await requireAdmin(req, db);
  if (!isManualId(itemId)) throw new Error('This product comes from Square. Archive it in Square instead.');
  const { error } = await db.from('catalog_products').update({ is_active: false }).eq('square_item_id', itemId);
  if (error) throw error;
  await writeAdminLog(db, admin.id, 'product.archived', itemId);
  return { success: true };
}

async function sendRestockEmails(db: SupabaseClient, recipients: Row[], productName: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('FROM_EMAIL');
  if (!apiKey || !from) throw new Error('Restock email is not configured.');
  const sent: string[] = [];
  for (const recipient of recipients) {
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [recipient.email], subject: `${productName} is back at Spin Hobby`, html: `<p><strong>${productName}</strong> is back in stock.</p><p><a href="https://spinhobby.com">Shop now</a></p>` }),
    });
    if (result.ok) sent.push(recipient.id);
  }
  return sent;
}

async function notifyRestock(req: Request, db: SupabaseClient, squareItemId: string) {
  const admin = await requireAdmin(req, db);
  const { data: variants, error: variantsError } = await db.from('catalog_variations').select('square_variation_id').eq('square_item_id', squareItemId);
  if (variantsError) throw variantsError;
  const ids = (variants ?? []).map((variant: Row) => variant.square_variation_id);
  const { data: alerts, error: alertError } = await db.from('stock_alerts').select('id,email').in('square_variation_id', ids).is('notified_at', null);
  if (alertError) throw alertError;
  const { data: product, error: productError } = await db.from('catalog_products').select('name').eq('square_item_id', squareItemId).single();
  if (productError) throw productError;
  const sent = await sendRestockEmails(db, alerts ?? [], product.name);
  if (sent.length) {
    const { error } = await db.from('stock_alerts').update({ notified_at: new Date().toISOString() }).in('id', sent);
    if (error) throw error;
  }
  await writeAdminLog(db, admin.id, 'product.restock_notified', squareItemId, { sent: sent.length });
  return { success: true, sent: sent.length };
}

async function adminOrders(req: Request, db: SupabaseClient, url: URL) {
  await requireAdmin(req, db);
  const status = url.searchParams.get('status');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 100);
  let query = db.from('orders').select('*,order_items(*)', { count: 'exact' }).order('created_at', { ascending: false }).limit(limit);
  if (status && status !== 'all') query = query.eq('status', status);
  const { data, error, count } = await query;
  if (error) throw error;
  return { success: true, items: data ?? [], total: count ?? 0 };
}

async function adminOrder(req: Request, db: SupabaseClient, id: string) {
  await requireAdmin(req, db);
  const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
  const { data, error } = await db.from('orders').select('*,order_items(*),order_events(*)').eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Order not found.');
  return { success: true, order: data };
}

async function shipOrder(req: Request, db: SupabaseClient, id: string) {
  const admin = await requireAdmin(req, db);
  const payload = await bodyAsJson(req);
  const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
  const trackingNumber = stringValue(payload.trackingNumber, 'trackingNumber', 200);
  const carrier = optionalString(payload.carrier, 100);
  const { data: order, error: findError } = await db.from('orders').select('status').eq('id', orderId).maybeSingle();
  if (findError) throw findError;
  if (!order || !['paid', 'fulfilled'].includes(order.status)) throw new Error('Only paid orders can be shipped.');
  const { error } = await db.from('orders').update({ status: 'shipped', tracking_number: trackingNumber, carrier, shipped_at: new Date().toISOString() }).eq('id', orderId);
  if (error) throw error;
  await db.from('order_events').insert({ order_id: orderId, actor_id: admin.id, event_type: 'shipped', data: { tracking_number: trackingNumber, carrier } });
  await writeAdminLog(db, admin.id, 'order.shipped', String(orderId), { trackingNumber, carrier });
  return { success: true };
}

async function refundOrder(req: Request, db: SupabaseClient, id: string) {
  const admin = await requireAdmin(req, db, true);
  const payload = await bodyAsJson(req);
  const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) throw error;
  if (!order?.provider_payment_id || !['paid', 'preorder_reserved', 'shipped', 'fulfilled'].includes(order.status)) throw new Error('This order cannot be refunded.');
  const amountCents = payload.amountCents === undefined ? Number(order.total_cents) : positiveInteger(payload.amountCents, 'amountCents', Number(order.total_cents));
  if (amountCents > Number(order.total_cents)) throw new Error('Refund amount exceeds the order total.');
  if (order.provider === 'paypal') {
    const token = await paypalToken();
    const result = await fetch(`${paypalBase()}/v2/payments/captures/${order.provider_payment_id}/refund`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `spin-hobby-refund-${order.id}-${amountCents}` },
      body: JSON.stringify({ amount: { currency_code: 'CAD', value: cents(amountCents) } }),
    });
    if (!result.ok) throw new Error('PayPal rejected the refund.');
  } else {
    await squareRequest('/v2/refunds', {
      idempotency_key: `spin-hobby-refund-${order.id}-${amountCents}`,
      payment_id: order.provider_payment_id,
      amount_money: { amount: amountCents, currency: 'CAD' },
    }, `spin-hobby-refund-${order.id}-${amountCents}`);
  }
  const status = amountCents === Number(order.total_cents) ? 'refunded' : order.status;
  const { error: updateError } = await db.from('orders').update({ status }).eq('id', orderId);
  if (updateError) throw updateError;
  await db.from('order_events').insert({ order_id: orderId, actor_id: admin.id, event_type: 'refunded', data: { amount_cents: amountCents } });
  await writeAdminLog(db, admin.id, 'order.refunded', String(orderId), { amountCents });
  return { success: true, status };
}

async function adminSettings(req: Request, db: SupabaseClient) {
  if (req.method === 'GET') {
    await requireAdmin(req, db);
    return { success: true, settings: await settings(db) };
  }
  const admin = await requireAdmin(req, db, true);
  const payload = await bodyAsJson(req);
  const allowed = ['payment_provider', 'shipping_standard_cents', 'shipping_express_cents', 'free_shipping_threshold_cents', 'low_stock_threshold', 'fx_cad_usd', 'handling_days_min', 'handling_days_max'];
  const update: Row = {};
  for (const key of allowed) if (key in payload) update[key] = payload[key];
  if (update.payment_provider && !['paypal', 'square'].includes(update.payment_provider)) throw new Error('Invalid payment provider.');
  for (const key of ['shipping_standard_cents', 'shipping_express_cents', 'free_shipping_threshold_cents', 'low_stock_threshold', 'handling_days_min', 'handling_days_max']) {
    if (update[key] !== undefined && (!Number.isInteger(Number(update[key])) || Number(update[key]) < 0)) throw new Error(`Invalid ${key}.`);
  }
  const { data, error } = await db.from('store_settings').update(update).eq('id', true).select().single();
  if (error) throw error;
  await writeAdminLog(db, admin.id, 'settings.updated', 'store', update);
  return { success: true, settings: data };
}

async function adminTaxRates(req: Request, db: SupabaseClient) {
  const admin = await requireAdmin(req, db, true);
  if (req.method === 'GET') {
    const { data, error } = await db.from('tax_rates').select('*').order('country').order('province');
    if (error) throw error;
    return { success: true, taxRates: data ?? [] };
  }
  const payload = await bodyAsJson(req);
  const country = payload.country === 'CA' || payload.country === 'US' ? payload.country : null;
  const province = stringValue(payload.province, 'province', 10).toUpperCase();
  const rate = Number(payload.rate);
  if (!country || !Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('Invalid tax rate.');
  const { data, error } = await db.from('tax_rates').upsert({ country, province, rate, enabled: payload.enabled !== false }).select().single();
  if (error) throw error;
  await writeAdminLog(db, admin.id, 'tax_rate.updated', `${country}/${province}`, { rate, enabled: payload.enabled !== false });
  return { success: true, taxRate: data };
}

async function adminSlides(req: Request, db: SupabaseClient, path: string) {
  const admin = await requireAdmin(req, db);
  const slideId = /^\/admin\/homepage\/slides\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (slideId && req.method === 'DELETE') {
    const { error } = await db.from('hero_slides').delete().eq('id', slideId);
    if (error) throw error;
    await writeAdminLog(db, admin.id, 'homepage.slide_deleted', slideId);
    return { success: true };
  }
  if (slideId && req.method === 'PUT') {
    const payload = await bodyAsJson(req);
    const update: Row = {};
    if ('headline' in payload) update.headline = stringValue(payload.headline, 'headline', 160);
    if ('subheading' in payload) update.subheading = optionalString(payload.subheading, 300);
    if ('imageUrl' in payload) update.image_url = optionalString(payload.imageUrl, 1000);
    if ('linkUrl' in payload) update.link_url = optionalString(payload.linkUrl, 1000);
    if ('isVisible' in payload) update.is_visible = payload.isVisible === true;
    if ('sortOrder' in payload && Number.isInteger(Number(payload.sortOrder))) update.sort_order = Number(payload.sortOrder);
    const { data, error } = await db.from('hero_slides').update(update).eq('id', slideId).select().single();
    if (error) throw error;
    await writeAdminLog(db, admin.id, 'homepage.slide_updated', slideId, update);
    return { success: true, slide: data };
  }
  if (slideId) throw new Error('Unsupported slide request.');
  if (path.endsWith('/reorder')) {
    const payload = await bodyAsJson(req);
    if (!Array.isArray(payload.ids) || payload.ids.length > 100) throw new Error('ids is required.');
    for (const [sortOrder, id] of payload.ids.entries()) {
      if (typeof id !== 'string') throw new Error('Invalid slide ID.');
      const { error } = await db.from('hero_slides').update({ sort_order: sortOrder }).eq('id', id);
      if (error) throw error;
    }
    await writeAdminLog(db, admin.id, 'homepage.slides_reordered', 'hero_slides');
    return { success: true };
  }
  if (req.method === 'GET') {
    const { data, error } = await db.from('hero_slides').select('*').order('sort_order');
    if (error) throw error;
    return { success: true, slides: data ?? [] };
  }
  const payload = await bodyAsJson(req);
  const record = {
    headline: stringValue(payload.headline, 'headline', 160),
    subheading: optionalString(payload.subheading, 300),
    image_url: optionalString(payload.imageUrl, 1000),
    link_url: optionalString(payload.linkUrl, 1000),
    is_visible: payload.isVisible === true,
    sort_order: Number.isInteger(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
  };
  const { data, error } = await db.from('hero_slides').insert(record).select().single();
  if (error) throw error;
  await writeAdminLog(db, admin.id, 'homepage.slide_created', data.id);
  return { success: true, slide: data };
}

async function adminEvents(req: Request, db: SupabaseClient, id?: string) {
  const admin = await requireAdmin(req, db);
  if (req.method === 'GET') {
    const { data, error } = await db.from('store_events').select('*').order('sort_order');
    if (error) throw error;
    return { success: true, events: data ?? [] };
  }
  if (req.method === 'DELETE') {
    if (!id) throw new Error('Event ID is required.');
    const { error } = await db.from('store_events').delete().eq('id', id);
    if (error) throw error;
    await writeAdminLog(db, admin.id, 'event.deleted', id);
    return { success: true };
  }
  const payload = await bodyAsJson(req);
  const record = {
    name: stringValue(payload.name, 'name', 160),
    city: optionalString(payload.city, 120),
    start_date: optionalString(payload.startDate, 30),
    end_date: optionalString(payload.endDate, 30),
    booth_info: optionalString(payload.boothInfo, 200),
    is_visible: payload.isVisible !== false,
    sort_order: Number.isInteger(Number(payload.sortOrder)) ? Number(payload.sortOrder) : 0,
  };
  const query = id ? db.from('store_events').update(record).eq('id', id) : db.from('store_events').insert(record);
  const { data, error } = await query.select().single();
  if (error) throw error;
  await writeAdminLog(db, admin.id, id ? 'event.updated' : 'event.created', data.id, record);
  return { success: true, event: data };
}

async function squareReadiness(req: Request, db: SupabaseClient) {
  await requireAdmin(req, db);
  const { data: catalog } = await db.from('catalog_products').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle();
  const { data: settingsData } = await db.from('store_settings').select('payment_provider').eq('id', true).single();
  return {
    success: true,
    readiness: {
      appAndLocationConnected: Boolean(Deno.env.get('SQUARE_ACCESS_TOKEN') && Deno.env.get('SQUARE_LOCATION_ID')),
      catalogAndInventorySyncing: Boolean(catalog?.synced_at),
      webhookKeySet: Boolean(Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') && Deno.env.get('SQUARE_WEBHOOK_URL')),
      sandboxPaymentsConfigured: Deno.env.get('SQUARE_ENV') === 'sandbox',
      threeDSecureEnabled: false,
      applePayDomainVerified: false,
      activeProvider: settingsData?.payment_provider,
      lastSyncAt: catalog?.synced_at ?? null,
    },
  };
}

async function triggerSquareSync(req: Request, db: SupabaseClient) {
  const admin = await requireAdmin(req, db, true);
  const url = Deno.env.get('SUPABASE_URL');
  const syncSecret = Deno.env.get('SQUARE_SYNC_TRIGGER_SECRET');
  if (!url || !syncSecret) throw new Error('The Square sync trigger secret is not configured.');
  const result = await fetch(`${url}/functions/v1/square-sync`, { method: 'POST', headers: { 'x-square-sync-secret': syncSecret, 'Content-Type': 'application/json' }, body: '{}' });
  if (!result.ok) throw new Error('Square sync could not be started.');
  const data = await result.json();
  await writeAdminLog(db, admin.id, 'square.sync_started', 'catalog');
  return { success: true, sync: data };
}

function packingSlipHtml(order: Row) {
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] ?? character));
  const shipping = order.shipping_address as Row;
  const items = (order.order_items ?? []).map((item: Row) => `<tr><td>${escape(item.name)}</td><td>${item.quantity}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Packing slip #${order.id}</title><style>body{font:14px system-ui;margin:32px;color:#171a2b}h1{margin:0 0 24px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}</style></head><body><h1>Spin Hobby · Packing slip #${order.id}</h1><p><strong>Ship to</strong><br>${escape(shipping.firstName ?? shipping.name?.first)} ${escape(shipping.lastName ?? shipping.name?.last)}<br>${escape(shipping.address1 ?? shipping.address?.primary)}<br>${escape(shipping.address2 ?? shipping.address?.secondary)}<br>${escape(shipping.city)}, ${escape(shipping.province)} ${escape(shipping.postalCode)}</p><table><thead><tr><th>Item</th><th>Qty</th></tr></thead><tbody>${items}</tbody></table></body></html>`;
}

async function squareCatalog(req: Request, db: SupabaseClient, path: string, url: URL) {
  if (path === '/square/config') return { success: true, applicationId: Deno.env.get('SQUARE_APPLICATION_ID') ?? null, locationId: Deno.env.get('SQUARE_LOCATION_ID') ?? null };
  if (path === '/square/display-categories') {
    const facets = await productFacets(db);
    return { success: true, categories: facets.categories.map((category) => ({ name: category.name, categoryIds: [category.name] })) };
  }
  if (path === '/square/inventory') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 100);
    const { data, error } = await db.from('inventory_snapshots').select('square_variation_id,quantity').in('square_variation_id', ids);
    if (error) throw error;
    return { success: true, quantities: Object.fromEntries((data ?? []).map((row: Row) => [row.square_variation_id, row.quantity])) };
  }
  const itemId = path.startsWith('/square/catalog/') ? decodeURIComponent(path.slice('/square/catalog/'.length)) : null;
  if (itemId) {
    const { data, error } = await db.from('storefront_products').select('*').eq('id', itemId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Catalog item not found.');
    return { success: true, item: publicProduct(data) };
  }
  return productPage(db, url);
}

// Public, non-secret values the checkout page needs to render the active payment method.
async function checkoutConfig(db: SupabaseClient) {
  const store = await settings(db);
  return {
    success: true,
    provider: store.payment_provider,
    paypalClientId: Deno.env.get('PAYPAL_CLIENT_ID') ?? null,
    paypalEnv: Deno.env.get('PAYPAL_ENV') === 'live' ? 'live' : 'sandbox',
    squareApplicationId: Deno.env.get('SQUARE_APPLICATION_ID') ?? null,
    squareLocationId: Deno.env.get('SQUARE_LOCATION_ID') ?? null,
    squareEnv: Deno.env.get('SQUARE_ENV') === 'production' ? 'production' : 'sandbox',
    shippingStandardCents: Number(store.shipping_standard_cents),
    shippingExpressCents: Number(store.shipping_express_cents),
    freeShippingThresholdCents: Number(store.free_shipping_threshold_cents),
    handlingDaysMin: Number(store.handling_days_min),
    handlingDaysMax: Number(store.handling_days_max),
    fxCadUsd: Number(store.fx_cad_usd),
  };
}

async function authMe(req: Request, db: SupabaseClient) {
  const user = await requireUser(req, db);
  return { success: true, user };
}

async function authLogout(req: Request, db: SupabaseClient) {
  const user = await requireUser(req, db);
  const { error } = await db.auth.admin.signOut(user.id, 'global');
  if (error) throw error;
  return { success: true };
}

async function router(req: Request) {
  if (!isAllowedOrigin(req)) return failure(req, 'Origin is not allowed.', 403);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const db = serviceClient();
  const url = new URL(req.url);
  const path = parseRoute(url.pathname, 'store-api').replace(/\/$/, '') || '/';

  if (req.method === 'POST' && path === '/webhooks/square') return squareWebhook(req, db);
  if (req.method === 'POST' && path === '/webhooks/paypal') return paypalWebhook(req, db);
  if (req.method === 'GET' && path === '/square/config') return response(req, await squareCatalog(req, db, path, url));
  if (req.method === 'GET' && path === '/square/display-categories') return response(req, await squareCatalog(req, db, path, url));
  if (req.method === 'GET' && path === '/square/inventory') return response(req, await squareCatalog(req, db, path, url));
  if (req.method === 'GET' && (path === '/square/catalog' || path.startsWith('/square/catalog/'))) return response(req, await squareCatalog(req, db, path, url));

  if (req.method === 'GET' && path === '/products') return response(req, await productPage(db, url));
  if (req.method === 'GET' && path === '/products/facets') return response(req, await productFacets(db));
  if (req.method === 'GET' && path === '/products/preorders') {
    url.searchParams.set('status', 'pre'); url.searchParams.set('sort', 'release');
    return response(req, await productPage(db, url));
  }
  if (req.method === 'GET' && path === '/products/ranking') {
    url.searchParams.set('sort', 'pop');
    const page = await productPage(db, url);
    return response(req, { ...page, items: page.items.filter((item: Row) => item.rank !== null) });
  }
  if (req.method === 'GET' && path === '/products/new-in-stock') {
    url.searchParams.set('status', 'in,low'); url.searchParams.set('sort', 'new');
    return response(req, await productPage(db, url));
  }
  if (req.method === 'GET' && path === '/homepage') return response(req, await homepage(db));
  if (req.method === 'GET' && path === '/categories') return response(req, { success: true, categories: await visibleCategories(db) });
  if (path === '/admin/categories' || path.startsWith('/admin/categories/')) return response(req, await adminCategories(req, db, path));
  if (req.method === 'POST' && path === '/admin/products/bulk-category') return response(req, await bulkCategory(req, db));
  if (req.method === 'GET' && path === '/checkout/config') return response(req, await checkoutConfig(db));
  if (req.method === 'GET' && path === '/auth/me') return response(req, await authMe(req, db));
  if (req.method === 'POST' && path === '/auth/logout') return response(req, await authLogout(req, db));
  if (req.method === 'GET' && path === '/wishlist') return response(req, await customerWishlist(req, db));
  if (req.method === 'POST' && path === '/wishlist') return response(req, await addWishlist(req, db));
  if (req.method === 'DELETE' && path.startsWith('/wishlist/')) return response(req, await removeWishlist(req, db, decodeURIComponent(path.slice('/wishlist/'.length))));
  if (req.method === 'POST' && path === '/alerts') return response(req, await createAlert(req, db));
  if (req.method === 'POST' && path === '/cart/quote') return response(req, { success: true, ...(await quoteCart(db, await bodyAsJson(req))) });
  if (req.method === 'POST' && path === '/checkout/intent') return response(req, await checkoutIntent(req, db));
  if (req.method === 'POST' && path === '/paypal/capture') return response(req, await capturePayPal(req, db));
  if (req.method === 'POST' && path === '/square/payments') return response(req, await captureSquare(req, db));
  if (req.method === 'GET' && path === '/orders') return response(req, await getOrders(req, db));
  if (req.method === 'GET' && path === '/orders/lookup') return response(req, await lookupOrder(req, db, url));
  if (req.method === 'GET' && path.startsWith('/orders/')) return response(req, await getOrder(req, db, path.slice('/orders/'.length)));

  if (req.method === 'GET' && path === '/admin/dashboard') return response(req, await adminDashboard(req, db));
  if (req.method === 'GET' && path === '/admin/products') return response(req, await adminProducts(req, db, url));
  if (req.method === 'POST' && path === '/admin/uploads') return response(req, await adminUpload(req, db));
  if (req.method === 'POST' && path === '/admin/products') return response(req, await createManualProduct(req, db));
  if (req.method === 'PATCH' && /^\/admin\/products\/[^/]+\/catalog$/.test(path)) return response(req, await updateManualProduct(req, db, decodeURIComponent(path.split('/')[3])));
  if (req.method === 'DELETE' && /^\/admin\/products\/[^/]+$/.test(path)) return response(req, await archiveManualProduct(req, db, decodeURIComponent(path.split('/')[3])));
  if (req.method === 'PATCH' && path.startsWith('/admin/products/') && !path.endsWith('/notify-restock')) return response(req, await updateProduct(req, db, decodeURIComponent(path.slice('/admin/products/'.length))));
  if (req.method === 'POST' && path.startsWith('/admin/products/') && path.endsWith('/notify-restock')) return response(req, await notifyRestock(req, db, decodeURIComponent(path.slice('/admin/products/'.length, -'/notify-restock'.length))));
  if (req.method === 'GET' && path === '/admin/orders') return response(req, await adminOrders(req, db, url));
  if (req.method === 'GET' && /^\/admin\/orders\/\d+$/.test(path)) return response(req, await adminOrder(req, db, path.split('/').at(-1)!));
  if (req.method === 'POST' && /^\/admin\/orders\/\d+\/ship$/.test(path)) return response(req, await shipOrder(req, db, path.split('/')[3]));
  if (req.method === 'POST' && /^\/admin\/orders\/\d+\/refund$/.test(path)) return response(req, await refundOrder(req, db, path.split('/')[3]));
  if (req.method === 'GET' && /^\/admin\/orders\/\d+\/packing-slip$/.test(path)) {
    await requireAdmin(req, db);
    const { data, error } = await db.from('orders').select('*,order_items(*)').eq('id', path.split('/')[3]).single();
    if (error) throw error;
    return response(req, { success: true, html: packingSlipHtml(data) });
  }
  if (path === '/admin/settings' && (req.method === 'GET' || req.method === 'PUT')) return response(req, await adminSettings(req, db));
  if (path === '/admin/tax-rates' && (req.method === 'GET' || req.method === 'PUT')) return response(req, await adminTaxRates(req, db));
  if (path === '/admin/homepage/slides' || path === '/admin/homepage/slides/reorder' || /^\/admin\/homepage\/slides\/[0-9a-f-]{36}$/.test(path)) return response(req, await adminSlides(req, db, path));
  if (path === '/admin/events' && (req.method === 'GET' || req.method === 'POST')) return response(req, await adminEvents(req, db));
  if (/^\/admin\/events\/[^/]+$/.test(path) && (req.method === 'PUT' || req.method === 'DELETE')) return response(req, await adminEvents(req, db, path.split('/').at(-1)));
  if (req.method === 'GET' && path === '/admin/square/readiness') return response(req, await squareReadiness(req, db));
  if (req.method === 'POST' && path === '/admin/square/sync') return response(req, await triggerSquareSync(req, db));

  return failure(req, 'Route not found.', 404);
}

Deno.serve(async (req) => {
  try {
    return await router(req);
  } catch (error) {
    const text = message(error);
    const status = text === 'Sign in is required.' ? 401 : text.includes('permission') ? 403 : 400;
    return failure(req, text, status);
  }
});
