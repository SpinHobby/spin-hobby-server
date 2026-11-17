-- The storefront's look, picked in Admin > Homepage > Theme (classic, water-glass, sakura, matcha, manga). The list lives in the
-- server (src/modules/admin/settings/themes.ts), so a new theme needs no migration; an id the server doesn't know shows classic.
alter table public.store_settings add column if not exists storefront_theme text not null default 'classic'
  check (length(storefront_theme) between 1 and 40);
