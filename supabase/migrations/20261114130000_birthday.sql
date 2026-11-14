-- A customer's birthday (month and day only, never the year), asked for in the optional welcome step after signing up.
alter table public.profiles add column if not exists birth_month smallint check (birth_month between 1 and 12);
alter table public.profiles add column if not exists birth_day smallint check (birth_day between 1 and 31);
