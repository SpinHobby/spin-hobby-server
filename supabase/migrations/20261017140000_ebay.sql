-- eBay: the shop's seller account, its listings, and every eBay sale applied to Square's stock.
-- Square stays the one count of what is on the shelf: an eBay sale takes the unit off Square (once: the order line is recorded here, and
-- the Square change carries an idempotency key made from it), and Square's count is pushed to every eBay listing.

-- The connected seller account (one per shop). Tokens are encrypted (see token-crypto.ts).
create table if not exists public.ebay_connection (
  id smallint primary key default 1 check (id = 1),
  environment text not null check (environment in ('sandbox', 'production')),
  marketplace_id text not null,
  username text,
  access_token text not null,
  access_expires_at timestamptz not null,
  refresh_token text not null,
  refresh_expires_at timestamptz,
  scopes text not null default '',
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  -- the seller's business policies and stock location every listing uses
  fulfillment_policy_id text,
  payment_policy_id text,
  return_policy_id text,
  merchant_location_key text,
  -- sync: how far the order check has read, and what went wrong last
  orders_read_until timestamptz,
  last_order_check_at timestamptz,
  last_push_at timestamptz,
  last_reconcile_at timestamptz,
  last_error text,
  last_error_at timestamptz
);

-- A sign-in in progress: the random state sent to eBay, checked when it comes back.
create table if not exists public.ebay_oauth_states (
  state text primary key,
  created_by uuid references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);

-- A product on eBay. The SKU ties eBay's listing (and its orders) to the Square product.
create table if not exists public.ebay_listings (
  square_item_id text primary key,
  variation_id text not null,
  sku text not null unique check (length(sku) between 1 and 50),
  offer_id text,
  listing_id text,
  status text not null default 'draft' check (status in ('draft', 'active', 'out_of_stock', 'ended', 'error')),
  title text not null check (length(title) between 1 and 80),
  category_id text not null,
  condition text not null,
  aspects jsonb not null default '{}'::jsonb,
  price_cents integer not null check (price_cents > 0),
  -- the quantity last sent to eBay, and Square's count it was taken from
  quantity integer not null default 0,
  pushed_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ebay_listings_set_updated_at before update on public.ebay_listings
  for each row execute procedure public.set_updated_at();

-- Every eBay order line seen: applied to Square once (status applied), put back once if the order is cancelled (restocked), or left
-- alone (skipped: not one of our listings).
create table if not exists public.ebay_order_lines (
  order_id text not null,
  line_item_id text not null,
  sku text,
  square_item_id text,
  quantity integer not null,
  status text not null check (status in ('applied', 'restocked', 'skipped', 'failed')),
  error text,
  ordered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, line_item_id)
);
create index if not exists ebay_order_lines_created_idx on public.ebay_order_lines (created_at desc);
create trigger ebay_order_lines_set_updated_at before update on public.ebay_order_lines
  for each row execute procedure public.set_updated_at();

alter table public.ebay_connection enable row level security;
alter table public.ebay_oauth_states enable row level security;
alter table public.ebay_listings enable row level security;
alter table public.ebay_order_lines enable row level security;
revoke all on public.ebay_connection, public.ebay_oauth_states, public.ebay_listings, public.ebay_order_lines from anon, authenticated;
create policy "Service role manages the eBay connection" on public.ebay_connection for all to service_role using (true) with check (true);
create policy "Service role manages eBay sign-ins" on public.ebay_oauth_states for all to service_role using (true) with check (true);
create policy "Service role manages eBay listings" on public.ebay_listings for all to service_role using (true) with check (true);
create policy "Service role manages eBay order lines" on public.ebay_order_lines for all to service_role using (true) with check (true);
