-- Spin Hobby: Square catalog mirror + storefront/admin operational data.
-- Square remains authoritative for item, variation, image and inventory data.

create extension if not exists pgcrypto;

create type public.app_role as enum ('customer', 'staff', 'owner');
create type public.product_availability as enum ('auto', 'preorder', 'backorder', 'hidden');
create type public.order_status as enum (
  'pending', 'paid', 'preorder_reserved', 'fulfilled', 'shipped', 'cancelled', 'refunded'
);
create type public.payment_provider as enum ('paypal', 'square');
create type public.shipping_method as enum ('standard', 'express');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  first_name text,
  last_name text,
  avatar_url text,
  role public.app_role not null default 'customer',
  square_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  address1 text not null,
  address2 text,
  city text not null,
  province text not null,
  postal_code text not null,
  country text not null check (country in ('CA', 'US')),
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customer_addresses_one_default_per_user
  on public.customer_addresses (user_id) where is_default;

-- Data mirrored from Square. No browser role can write these tables.
create table public.catalog_products (
  square_item_id text primary key,
  name text not null,
  description text,
  category text,
  category_ids text[] not null default '{}',
  default_variation_id text,
  is_active boolean not null default true,
  is_visible boolean not null default true,
  square_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_products_search_idx on public.catalog_products using gin (
  to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(category, ''))
);
create index catalog_products_category_idx on public.catalog_products(category) where is_active and is_visible;

create table public.catalog_variations (
  square_variation_id text primary key,
  square_item_id text not null references public.catalog_products(square_item_id) on delete cascade,
  name text,
  sku text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'CAD' check (currency = 'CAD'),
  is_sellable boolean not null default true,
  square_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_variations_product_idx on public.catalog_variations(square_item_id);

alter table public.catalog_products
  add constraint catalog_products_default_variation_fk
  foreign key (default_variation_id)
  references public.catalog_variations(square_variation_id)
  deferrable initially deferred;

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  square_item_id text not null references public.catalog_products(square_item_id) on delete cascade,
  square_image_id text unique,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (square_item_id, sort_order)
);
create index product_images_product_idx on public.product_images(square_item_id, sort_order);

create table public.product_metadata (
  square_item_id text primary key references public.catalog_products(square_item_id) on delete cascade,
  availability public.product_availability not null default 'auto',
  release_month date,
  order_by_date timestamptz,
  series text,
  character text,
  manufacturer text,
  jan_code text unique,
  compare_at_cents integer check (compare_at_cents is null or compare_at_cents >= 0),
  max_per_customer integer check (max_per_customer is null or max_per_customer > 0),
  deposit_cents integer check (deposit_cents is null or deposit_cents >= 0),
  is_featured boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_metadata_storefront_idx
  on public.product_metadata(availability, order_by_date, is_featured, sort_order);
create index product_metadata_search_idx on public.product_metadata using gin (
  to_tsvector('simple', coalesce(series, '') || ' ' || coalesce(character, '') || ' ' || coalesce(jan_code, ''))
);

create table public.inventory_snapshots (
  square_variation_id text primary key references public.catalog_variations(square_variation_id) on delete cascade,
  quantity integer check (quantity is null or quantity >= 0),
  square_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sales_stats (
  square_item_id text primary key references public.catalog_products(square_item_id) on delete cascade,
  units_7d integer not null default 0 check (units_7d >= 0),
  rank integer check (rank is null or rank > 0),
  updated_at timestamptz not null default now()
);

create table public.wishlist_items (
  user_id uuid not null references public.profiles(id) on delete cascade,
  square_item_id text not null references public.catalog_products(square_item_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, square_item_id)
);

create table public.stock_alerts (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  square_variation_id text not null references public.catalog_variations(square_variation_id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (email, square_variation_id)
);
create index stock_alerts_variation_idx on public.stock_alerts(square_variation_id) where notified_at is null;

create table public.store_settings (
  id boolean primary key default true check (id),
  payment_provider public.payment_provider not null default 'paypal',
  shipping_standard_cents integer not null default 899 check (shipping_standard_cents >= 0),
  shipping_express_cents integer not null default 1999 check (shipping_express_cents >= 0),
  free_shipping_threshold_cents integer not null default 7500 check (free_shipping_threshold_cents >= 0),
  low_stock_threshold integer not null default 3 check (low_stock_threshold >= 0),
  fx_cad_usd numeric(8, 5) not null default 0.73000 check (fx_cad_usd > 0),
  handling_days_min integer not null default 2 check (handling_days_min >= 0),
  handling_days_max integer not null default 3 check (handling_days_max >= handling_days_min),
  updated_at timestamptz not null default now()
);
insert into public.store_settings (id) values (true);

create table public.tax_rates (
  country text not null check (country in ('CA', 'US')),
  province text not null,
  rate numeric(7, 6) not null check (rate >= 0 and rate <= 1),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (country, province)
);

-- Canada Revenue Agency rates, verified 2026-09-27. US collection starts disabled
-- until the merchant confirms nexus and registration requirements.
insert into public.tax_rates (country, province, rate) values
  ('CA', 'AB', 0.050000), ('CA', 'BC', 0.120000), ('CA', 'MB', 0.120000),
  ('CA', 'NB', 0.150000), ('CA', 'NL', 0.150000), ('CA', 'NS', 0.140000),
  ('CA', 'NT', 0.050000), ('CA', 'NU', 0.050000), ('CA', 'ON', 0.130000),
  ('CA', 'PE', 0.150000), ('CA', 'QC', 0.149750), ('CA', 'SK', 0.110000),
  ('CA', 'YT', 0.050000);

create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  status public.order_status not null default 'pending',
  provider public.payment_provider not null,
  provider_payment_id text unique,
  square_order_id text unique,
  receipt_url text,
  provider_metadata jsonb not null default '{}'::jsonb,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null check (shipping_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'CAD' check (currency = 'CAD'),
  shipping_method public.shipping_method not null,
  tracking_number text,
  carrier text,
  shipped_at timestamptz,
  billing_email text not null check (billing_email = lower(billing_email)),
  billing_address jsonb not null,
  shipping_address jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_user_created_idx on public.orders(user_id, created_at desc);
create index orders_status_created_idx on public.orders(status, created_at desc);
create index orders_pending_payment_idx on public.orders(provider, status) where status = 'pending';

create table public.order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  square_item_id text not null,
  square_variation_id text not null,
  name text not null,
  image_url text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  is_preorder boolean not null default false,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_variation_idx on public.order_items(square_variation_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on public.order_events(order_id, created_at);

create table public.hero_slides (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  subheading text,
  image_url text,
  link_url text,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index hero_slides_visible_idx on public.hero_slides(sort_order) where is_visible;

create table public.store_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  start_date date,
  end_date date,
  booth_info text,
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.webhook_events (
  id text primary key,
  provider text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create table public.admin_logs (
  id bigint generated always as identity primary key,
  admin_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  target text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_logs_admin_created_idx on public.admin_logs(admin_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, first_name, last_name, avatar_url)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        first_name = coalesce(excluded.first_name, public.profiles.first_name),
        last_name = coalesce(excluded.last_name, public.profiles.last_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.product_status(
  availability public.product_availability,
  order_by_date timestamptz,
  quantity integer,
  low_stock_threshold integer
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when availability = 'hidden' then 'hidden'
    when availability in ('preorder', 'backorder') and order_by_date is not null and order_by_date < now() then 'closed'
    when availability in ('preorder', 'backorder') then 'pre'
    when quantity is null then 'in'
    when quantity <= 0 then 'out'
    when quantity <= low_stock_threshold then 'low'
    else 'in'
  end;
$$;

create or replace view public.storefront_products
with (security_invoker = true)
as
select
  p.square_item_id as id,
  v.square_variation_id as variation_id,
  p.name,
  p.category,
  p.description,
  coalesce(m.series, null) as series,
  coalesce(m.character, null) as character,
  coalesce(m.jan_code, null) as jan_code,
  v.price_cents,
  v.currency,
  m.compare_at_cents,
  public.product_status(coalesce(m.availability, 'auto'), m.order_by_date, i.quantity, s.low_stock_threshold) as status,
  i.quantity as stock_count,
  m.release_month,
  m.order_by_date,
  stats.rank,
  m.max_per_customer,
  coalesce(m.is_featured, false) as is_featured,
  coalesce(m.sort_order, 0) as sort_order,
  coalesce(images.images, array[]::text[]) as images,
  p.created_at,
  p.updated_at
from public.catalog_products p
join public.catalog_variations v
  on v.square_variation_id = p.default_variation_id and v.is_sellable
left join public.product_metadata m on m.square_item_id = p.square_item_id
left join public.inventory_snapshots i on i.square_variation_id = v.square_variation_id
left join public.sales_stats stats on stats.square_item_id = p.square_item_id
cross join public.store_settings s
left join lateral (
  select array_agg(pi.image_url order by pi.sort_order) as images
  from public.product_images pi
  where pi.square_item_id = p.square_item_id
) images on true
where p.is_active and p.is_visible and coalesce(m.availability, 'auto') <> 'hidden';

-- Explicit grants are required because Supabase no longer exposes new public
-- tables automatically. The client can only access its own account data;
-- catalog/admin/checkout requests go through the Edge Function.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (first_name, last_name, avatar_url) on public.profiles to authenticated;
grant select, insert, update, delete on public.customer_addresses to authenticated;
grant select, insert, delete on public.wishlist_items to authenticated;
grant select on public.stock_alerts to authenticated;
grant select on public.orders, public.order_items, public.order_events to authenticated;

alter table public.profiles enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_variations enable row level security;
alter table public.product_images enable row level security;
alter table public.product_metadata enable row level security;
alter table public.inventory_snapshots enable row level security;
alter table public.sales_stats enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.stock_alerts enable row level security;
alter table public.store_settings enable row level security;
alter table public.tax_rates enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.hero_slides enable row level security;
alter table public.store_events enable row level security;
alter table public.webhook_events enable row level security;
alter table public.admin_logs enable row level security;

create policy "Users read their profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "Users update safe profile fields" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users manage their addresses" on public.customer_addresses
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users manage their wishlist" on public.wishlist_items
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users read their alerts" on public.stock_alerts
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users read their orders" on public.orders
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their order items" on public.order_items
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = (select auth.uid())
    )
  );
create policy "Users read their order events" on public.order_events
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_events.order_id and o.user_id = (select auth.uid())
    )
  );

-- Private asset bucket. Only Edge Functions using the service key may write.
insert into storage.buckets (id, name, public)
values ('storefront-assets', 'storefront-assets', false)
on conflict (id) do update set public = excluded.public;

-- Updated-at triggers.
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute procedure public.set_updated_at();
create trigger addresses_set_updated_at before update on public.customer_addresses
  for each row execute procedure public.set_updated_at();
create trigger catalog_products_set_updated_at before update on public.catalog_products
  for each row execute procedure public.set_updated_at();
create trigger catalog_variations_set_updated_at before update on public.catalog_variations
  for each row execute procedure public.set_updated_at();
create trigger product_images_set_updated_at before update on public.product_images
  for each row execute procedure public.set_updated_at();
create trigger product_metadata_set_updated_at before update on public.product_metadata
  for each row execute procedure public.set_updated_at();
create trigger inventory_set_updated_at before update on public.inventory_snapshots
  for each row execute procedure public.set_updated_at();
create trigger settings_set_updated_at before update on public.store_settings
  for each row execute procedure public.set_updated_at();
create trigger tax_rates_set_updated_at before update on public.tax_rates
  for each row execute procedure public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders
  for each row execute procedure public.set_updated_at();
create trigger hero_slides_set_updated_at before update on public.hero_slides
  for each row execute procedure public.set_updated_at();
create trigger store_events_set_updated_at before update on public.store_events
  for each row execute procedure public.set_updated_at();
