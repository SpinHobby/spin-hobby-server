-- The storefront's "Shop playlist": a YouTube playlist shoppers can choose to play in a visible player (nothing plays on its own).
-- Null hides the button.
alter table public.store_settings add column if not exists music_playlist_id text;
