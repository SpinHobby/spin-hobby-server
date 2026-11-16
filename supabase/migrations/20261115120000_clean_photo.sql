-- Clean product photo: the figure alone with no box print, drawn by the photo computer (Gleamshelf), offered first among a draft's photos.
alter table public.product_imports add column if not exists clean_url text;
