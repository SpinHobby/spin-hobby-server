-- Barcodes (JAN / EAN-13, UPC) found for products that have none: Google Shopping ranks a listing with one (its GTIN) far above one without.
-- The connected Gleamshelf app reads them off the product's photos, and the product pages it matched to the cover give theirs. A person
-- applies or dismisses each one in the admin; nothing is written to a product without that.
create table if not exists public.barcode_findings (
  square_item_id text primary key references public.catalog_products(square_item_id) on delete cascade,
  -- scanning: claimed by the app; none: looked, nothing found; found: waiting for a person; applied / dismissed: decided
  status text not null default 'scanning' check (status in ('scanning', 'none', 'found', 'applied', 'dismissed')),
  code text check (code ~ '^[0-9]{8}$|^[0-9]{13}$'),
  source text check (source in ('photo', 'page', 'both')),
  claimed_at timestamptz,
  found_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz
);
create index if not exists barcode_findings_status_idx on public.barcode_findings (status);
alter table public.barcode_findings enable row level security;
revoke all on public.barcode_findings from anon, authenticated;
