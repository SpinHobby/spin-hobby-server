-- "Ask us to find one": a shopper who missed a sold item asks for another. No payment and no promise. Staff see the requests counted
-- per item (the most wanted first) and answer all of an item's requests at once: found (with a note, and the listing to buy), or not
-- found. Kept apart from stock_alerts ("email me when this is back"), which this does not change.
create table if not exists public.item_requests (
  id uuid primary key default gen_random_uuid(),
  square_item_id text not null,
  -- the name when asked: the product may be renamed or removed later
  product_name text not null check (char_length(product_name) between 1 and 300),
  email text not null check (char_length(email) between 3 and 320),
  user_id uuid references public.profiles(id) on delete set null,
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'waiting' check (status in ('waiting', 'found', 'not_found')),
  answer text check (answer is null or char_length(answer) <= 600),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
-- one waiting request per person and item
create unique index if not exists item_requests_one_waiting
  on public.item_requests (square_item_id, lower(email)) where status = 'waiting';
create index if not exists item_requests_waiting_idx on public.item_requests (square_item_id) where status = 'waiting';
alter table public.item_requests enable row level security;
revoke all on public.item_requests from anon, authenticated;
create policy "Service role manages item requests" on public.item_requests for all to service_role using (true) with check (true);
