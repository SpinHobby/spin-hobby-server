-- The barcode (UPC / EAN / JAN) Square holds on each variation, so what is scanned or typed when a product is
-- added reaches Square (its POS scans it) and comes back here on sync.
alter table public.catalog_variations add column if not exists upc text;
create index if not exists catalog_variations_upc_idx on public.catalog_variations (upc) where upc is not null;
