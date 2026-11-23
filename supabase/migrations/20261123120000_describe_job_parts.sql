-- Which parts of a product a person asked the photo computer to redo (title, description, details = series and maker, category).
-- Null: sent from the Descriptions screen, where the description is what was asked for. The review ticks these parts first.
alter table public.describe_jobs add column if not exists parts text[];
