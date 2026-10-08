-- A hand-entered product that is moved into Square stays behind as a retired row that points at its Square
-- successor. That keeps old orders and links resolvable, and lets a half-finished move be resumed safely.
alter table public.catalog_products add column if not exists replaced_by text;
create index if not exists catalog_products_replaced_by_idx
  on public.catalog_products (replaced_by) where replaced_by is not null;
