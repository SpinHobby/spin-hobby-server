-- Live courier rates at checkout (EasyPost: Canada Post, UPS, Purolator...). A rate needs where the parcel leaves from and what it
-- weighs and measures, so: the shop's ship-from address, a default parcel, and a weight and box size per category (inherited by
-- subcategories) or per product. Without an EasyPost key or a ship-from postal code, checkout keeps the flat standard/express prices.
alter table public.store_settings
  add column if not exists ship_from_postal text,
  add column if not exists ship_from_city text,
  add column if not exists ship_from_province text,
  add column if not exists parcel_weight_g integer not null default 500 check (parcel_weight_g > 0),
  add column if not exists parcel_length_cm integer not null default 30 check (parcel_length_cm > 0),
  add column if not exists parcel_width_cm integer not null default 20 check (parcel_width_cm > 0),
  add column if not exists parcel_height_cm integer not null default 15 check (parcel_height_cm > 0),
  -- the box and padding every order adds
  add column if not exists packaging_weight_g integer not null default 150 check (packaging_weight_g >= 0);

alter table public.store_categories
  add column if not exists parcel_weight_g integer check (parcel_weight_g > 0),
  add column if not exists parcel_length_cm integer check (parcel_length_cm > 0),
  add column if not exists parcel_width_cm integer check (parcel_width_cm > 0),
  add column if not exists parcel_height_cm integer check (parcel_height_cm > 0);

alter table public.product_metadata
  add column if not exists parcel_weight_g integer check (parcel_weight_g > 0),
  add column if not exists parcel_length_cm integer check (parcel_length_cm > 0),
  add column if not exists parcel_width_cm integer check (parcel_width_cm > 0),
  add column if not exists parcel_height_cm integer check (parcel_height_cm > 0);

-- the courier option the shopper chose (e.g. Canada Post, Expedited Parcel, 2 days), so the order can be shipped the way it was paid for
alter table public.orders
  add column if not exists shipping_carrier text,
  add column if not exists shipping_service text,
  add column if not exists shipping_days integer;
