-- The storefront layout chosen in Admin > Homepage > Page layout: homepage block order and visibility, default product view,
-- columns, photo shape, filters position, page width, top bar. Null is the default layout (src/modules/admin/settings/layout.ts).
alter table public.store_settings add column if not exists storefront_layout jsonb;
