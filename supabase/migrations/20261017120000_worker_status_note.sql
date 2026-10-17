-- Why a connected photo computer cannot do some work right now, in its own words ("web search is not answering", "the vision model is not installed"),
-- sent each time it asks for work, so the admin can say why photos wait instead of showing a bare "Waiting".
alter table public.import_tokens
  add column if not exists status_note text check (length(status_note) <= 200);
