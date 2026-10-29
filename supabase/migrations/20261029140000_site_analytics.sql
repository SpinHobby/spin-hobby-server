-- Anonymous shopping-step counts, per shop day: how many visits, product views, add-to-carts and checkouts the website saw.
-- No cookies, accounts, addresses or anything else that identifies a person: just a number per day, step and (for product views
-- and add-to-carts) product. Paid orders are counted from public.orders.
create table if not exists public.analytics_daily (
  day date not null,
  event text not null check (event in ('visit', 'product_view', 'add_to_cart', 'checkout_view')),
  product_id text not null default '',
  count integer not null default 0 check (count >= 0),
  primary key (day, event, product_id)
);
alter table public.analytics_daily enable row level security;
revoke all on public.analytics_daily from anon, authenticated;
