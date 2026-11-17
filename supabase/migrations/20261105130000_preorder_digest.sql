-- "Email me new pre-orders, once a week": a follow of every pre-order (kind 'all'), sent as a weekly digest instead of one email per
-- new item. `last_sent_at` is when that follower last got the digest; the next one lists what was announced since.
alter table public.follows drop constraint if exists follows_kind_check;
alter table public.follows add constraint follows_kind_check check (kind in ('series', 'maker', 'all'));
alter table public.follows add column if not exists last_sent_at timestamptz;
