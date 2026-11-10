-- Product reviews from verified buyers. Each review belongs to the order the item came from (one per item per order), so only someone
-- who bought the item can write one, signed in or with their order number and email. Nothing shows on the shop until staff approve it.
create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  square_item_id text not null,
  order_id bigint not null references public.orders(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  author_name text not null check (length(author_name) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  title text check (length(title) <= 120),
  body text not null check (length(body) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- the shop's public answer, shown under the review
  reply text check (length(reply) <= 1000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (order_id, square_item_id)
);
create index if not exists product_reviews_item_idx on public.product_reviews (square_item_id, created_at desc)
  where status = 'approved';
create index if not exists product_reviews_pending_idx on public.product_reviews (created_at) where status = 'pending';

alter table public.product_reviews enable row level security;
