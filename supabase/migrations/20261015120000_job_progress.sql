-- How far a photo computer has got with the job it is working on, so the admin can show a progress bar instead of a bare "being worked on":
-- a percentage, the step it is on, and when it started. Reported by the worker as it goes; cleared when the job goes back in the queue.
alter table public.listing_jobs
  add column if not exists progress smallint check (progress between 0 and 100),
  add column if not exists step text check (length(step) <= 80),
  add column if not exists started_at timestamptz;
alter table public.photo_jobs
  add column if not exists progress smallint check (progress between 0 and 100),
  add column if not exists step text check (length(step) <= 80),
  add column if not exists started_at timestamptz;
