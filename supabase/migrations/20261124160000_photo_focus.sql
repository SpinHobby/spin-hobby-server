-- Where the face is in a product photo. A photo shown large and cropped (the pictures behind a home page banner ad) is framed on this
-- point instead of the middle of the photo: x, y are the point kept in view (0-100 % across and down the photo) and zoom is how far in
-- (1 = none, up to 4). A photo with no row gets the shop's guess (upper middle). Apart from photo_frames, which places a photo in its
-- square on a product card: a card keeps the whole product, a banner picture shows the face.
create table if not exists public.photo_focus (
  square_item_id text not null,
  image_url text not null check (length(image_url) between 1 and 1000),
  x real not null check (x between 0 and 100),
  y real not null check (y between 0 and 100),
  zoom real not null default 1 check (zoom between 1 and 4),
  updated_at timestamptz not null default now(),
  primary key (square_item_id, image_url)
);
alter table public.photo_focus enable row level security;
revoke all on public.photo_focus from anon, authenticated;
create policy "Service role manages photo focus" on public.photo_focus for all to service_role using (true) with check (true);
create trigger photo_focus_set_updated_at before update on public.photo_focus
  for each row execute procedure public.set_updated_at();
