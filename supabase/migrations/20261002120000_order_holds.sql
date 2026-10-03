-- Stock holds: when an order was actually paid.
-- orders.updated_at also moves on shipping and refunds, so it can't say when the sale happened.
alter table public.orders add column if not exists paid_at timestamptz;

-- Backfill from the 'paid' event (the best record of the payment), then fall back to updated_at
-- for any paid-looking order that has no event.
update public.orders o
   set paid_at = e.paid
  from (
    select order_id, min(created_at) as paid
      from public.order_events
     where event_type = 'paid'
     group by order_id
  ) e
 where e.order_id = o.id and o.paid_at is null;

update public.orders
   set paid_at = updated_at
 where paid_at is null
   and status in ('paid', 'preorder_reserved', 'fulfilled', 'shipped', 'refunded');

create index if not exists orders_paid_at_idx on public.orders (paid_at) where paid_at is not null;
