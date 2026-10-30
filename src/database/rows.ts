/**
 * The shape of one row in each main table, as the `pg` driver returns it (see the type parsers in
 * db.service.ts): bigint and numeric columns are numbers, timestamps are ISO strings, dates are
 * "YYYY-MM-DD" strings, jsonb is already parsed. Keep these in step with supabase/migrations.
 *
 * Use them as the type argument of a query, and `Pick` when a query selects only some columns:
 *
 *   const order = await this.db.one<Pick<OrderRow, 'id' | 'status'>>('select id, status from public.orders where id = $1', [id]);
 */

export type OrderStatus =
  'pending' | 'paid' | 'preorder_reserved' | 'fulfilled' | 'shipped' | 'cancelled' | 'refunded';
export type PaymentProvider = 'paypal' | 'square';
export type ShippingMethod = 'standard' | 'express';
import type { AppRole } from '../modules/auth/roles.js';
export type { AppRole };
export type ProductAvailability = 'auto' | 'preorder' | 'backorder' | 'hidden';

/**
 * A postal address as stored (jsonb) on an order: whatever the checkout form sent. The `name` and `address`
 * objects are an older shape that early orders still use.
 */
export interface AddressJson {
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  name?: { first?: string; last?: string };
  address?: { primary?: string; secondary?: string };
}

export interface ProfileRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  role: AppRole;
  square_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderRow {
  id: number;
  user_id: string | null;
  status: OrderStatus;
  provider: PaymentProvider;
  provider_payment_id: string | null;
  square_order_id: string | null;
  receipt_url: string | null;
  provider_metadata: Record<string, unknown>;
  subtotal_cents: number;
  /** What a discount code took off the goods; total = subtotal - discount + shipping + tax. */
  discount_code: string | null;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  currency: 'CAD';
  shipping_method: ShippingMethod;
  tracking_number: string | null;
  carrier: string | null;
  shipped_at: string | null;
  /** When the payment was confirmed (not the same as updated_at, which also moves on shipping and refunds). */
  paid_at: string | null;
  billing_email: string;
  billing_address: AddressJson;
  shipping_address: AddressJson;
  created_at: string;
  updated_at: string;
  /** The courier option chosen at checkout (live rates); null on older orders and flat-price ones. */
  shipping_carrier?: string | null;
  shipping_service?: string | null;
  shipping_days?: number | null;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  square_item_id: string;
  square_variation_id: string;
  name: string;
  image_url: string | null;
  unit_price_cents: number;
  quantity: number;
  is_preorder: boolean;
  created_at: string;
}

export interface OrderEventRow {
  id: number;
  order_id: number;
  actor_id: string | null;
  event_type: string;
  data: Record<string, unknown>;
  created_at: string;
}

/** An order with its line items attached as JSON (see ITEMS_AS_JSON in modules/orders/order-sql.ts). */
export type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };
/** ...and its history too (EVENTS_AS_JSON). */
export type OrderWithDetails = OrderWithItems & { order_events: OrderEventRow[] };

export interface CatalogProductRow {
  square_item_id: string;
  name: string;
  description: string | null;
  category: string | null;
  category_ids: string[];
  default_variation_id: string | null;
  is_active: boolean;
  is_visible: boolean;
  /** `square` for items synced from Square, `manual` for items staff created in the admin. */
  source: 'square' | 'manual';
  /** Set on a hand-entered product that was moved into Square: the id of its Square replacement. */
  replaced_by: string | null;
  square_updated_at: string | null;
  /** When the item was created in Square (our `created_at` is when we first saw it). */
  square_created_at: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface CatalogVariationRow {
  square_variation_id: string;
  square_item_id: string;
  name: string | null;
  sku: string | null;
  /** The barcode (UPC / EAN / JAN) Square holds on the variation. */
  upc: string | null;
  price_cents: number;
  currency: 'CAD';
  is_sellable: boolean;
  square_updated_at: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface ProductMetadataRow {
  square_item_id: string;
  availability: ProductAvailability;
  release_month: string | null;
  order_by_date: string | null;
  series: string | null;
  /** The entry in the `series` list this product belongs to; null when it has none. */
  series_id: string | null;
  character: string | null;
  manufacturer: string | null;
  jan_code: string | null;
  compare_at_cents: number | null;
  max_per_customer: number | null;
  deposit_cents: number | null;
  is_featured: boolean;
  sort_order: number;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImageRow {
  id: string;
  square_item_id: string;
  square_image_id: string | null;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface InventorySnapshotRow {
  square_variation_id: string;
  /** null when Square does not track a count for the variation. */
  quantity: number | null;
  square_updated_at: string | null;
  synced_at: string;
  updated_at: string;
}

/** A row of the `storefront_products` view: what the public shop shows for one catalog item. */
export interface StorefrontProductRow {
  id: string;
  variation_id: string | null;
  name: string;
  series: string | null;
  character: string | null;
  category: string | null;
  category_id: string | null;
  description: string | null;
  jan_code: string | null;
  images: string[];
  /** Which of `images` are transparent cut-outs (shown on the shop background). */
  cutout_images?: string[];
  /** The maker (brand), for search engines. */
  manufacturer?: string | null;
  price_cents: number;
  compare_at_cents: number | null;
  currency: string;
  /** `in`, `low`, `out`, `pre` or `closed` (see public.product_status). */
  status: string;
  stock_count: number | null;
  release_month: string | null;
  order_by_date: string | null;
  rank: number | null;
  max_per_customer: number | null;
  is_featured: boolean;
  sort_order: number;
  source: 'square' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface HeroSlideRow {
  id: string;
  headline: string;
  subheading: string | null;
  image_url: string | null;
  link_url: string | null;
  sort_order: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface StoreEventRow {
  id: string;
  name: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  booth_info: string | null;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaxRateRow {
  country: 'CA' | 'US';
  province: string;
  /** A fraction, e.g. 0.05 for 5%. */
  rate: number;
  enabled: boolean;
  updated_at: string;
}

export interface StoreSettingsRow {
  payment_provider: PaymentProvider;
  shipping_standard_cents: number;
  shipping_express_cents: number;
  free_shipping_threshold_cents: number;
  low_stock_threshold: number;
  fx_cad_usd: number;
  handling_days_min: number;
  handling_days_max: number;
  maintenance_mode: boolean;
  maintenance_message: string | null;
  /** The storefront's Shop playlist (a YouTube playlist id); null hides it. */
  music_playlist_id: string | null;
  /** Where parcels leave from, for live courier rates (shipping-rates.service.ts); no postal code means flat prices. */
  ship_from_postal: string | null;
  ship_from_city: string | null;
  ship_from_province: string | null;
  /** The default packed size of one item (grams, cm), used when neither the product nor its category says. */
  parcel_weight_g: number;
  parcel_length_cm: number;
  parcel_width_cm: number;
  parcel_height_cm: number;
  /** What the box and padding add to every order (grams). */
  packaging_weight_g: number;
  updated_at: string;
}
