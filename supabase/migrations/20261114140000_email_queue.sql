-- Resend's plan limits how many emails go out a day and a month. The API counts what it sends (email_usage, one row per UTC day)
-- and holds back what would go over the limit in email_queue, sending it after the limit resets: sign-up codes and order emails
-- first, news and reminders last. Admin > Dashboard shows both.
create table if not exists public.email_usage (
  day date primary key,
  sent integer not null default 0
);
alter table public.email_usage enable row level security;

create table if not exists public.email_queue (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  html text not null,
  -- code (sign-up codes), order (receipts, shipped, refunds), welcome, news (restock, reminders, pre-order news)
  kind text not null check (kind in ('code', 'order', 'welcome', 'news')),
  priority smallint not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz
);
create index if not exists email_queue_waiting on public.email_queue (priority, created_at) where sent_at is null;
alter table public.email_queue enable row level security;
