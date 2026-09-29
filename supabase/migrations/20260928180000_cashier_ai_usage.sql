-- Cashier photo identification (Claude) cost tracking, ported from the legacy
-- Express server (db/migrations/009_create_ai_usage_tracking.sql).
-- Server-only: no browser role can read or write these tables.

create table public.ai_usage_log (
  id bigint generated always as identity primary key,
  tool text not null,
  cost_usd numeric(10, 4) not null check (cost_usd >= 0),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index ai_usage_log_tool_created_idx on public.ai_usage_log (tool, created_at desc);

create table public.ai_budgets (
  tool text primary key,
  warn_threshold_usd numeric(10, 2) not null default 20 check (warn_threshold_usd >= 0),
  stop_threshold_usd numeric(10, 2) not null default 30 check (stop_threshold_usd >= 0),
  updated_at timestamptz not null default now()
);
create trigger ai_budgets_set_updated_at before update on public.ai_budgets
  for each row execute procedure public.set_updated_at();

alter table public.ai_usage_log enable row level security;
alter table public.ai_budgets enable row level security;
revoke all on public.ai_usage_log, public.ai_budgets from anon, authenticated;
create policy "Service role manages AI usage" on public.ai_usage_log
  for all to service_role using (true) with check (true);
create policy "Service role manages AI budgets" on public.ai_budgets
  for all to service_role using (true) with check (true);
