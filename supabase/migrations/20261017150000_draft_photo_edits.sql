-- A person's own edit of a draft's photo (cropped, straightened, retouched in the admin's photo editor), by photo: { "cropped": url, ... }.
-- The photo as offered is kept, so an edit can be undone; the edit is what goes to Square and eBay.
alter table public.product_imports add column if not exists edited_photos jsonb not null default '{}'::jsonb;
